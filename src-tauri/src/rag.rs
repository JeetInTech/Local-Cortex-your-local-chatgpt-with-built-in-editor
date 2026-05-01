use ignore::WalkBuilder;
use rayon::prelude::*;
use reqwest::Client;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use tokio::sync::RwLock;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Chunk {
    pub file_path: String,
    pub content: String,
    pub start_line: usize,
    pub end_line: usize,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct VectorRecord {
    pub chunk: Chunk,
    pub embedding: Vec<f32>,
}

#[derive(Debug, Serialize, Deserialize, Default)]
struct PersistedStore {
    records: Vec<VectorRecord>,
}

#[derive(Debug, Serialize, Deserialize)]
struct OllamaEmbedRequest {
    model: String,
    prompt: String,
}

#[derive(Debug, Deserialize)]
struct OllamaEmbedResponse {
    embedding: Vec<f32>,
}

pub fn chunk_file(path: &Path) -> Vec<Chunk> {
    let mut chunks = Vec::new();
    let content = match std::fs::read_to_string(path) {
        Ok(c) => c,
        Err(_) => return chunks,
    };

    let lines: Vec<&str> = content.lines().collect();
    if lines.is_empty() {
        return chunks;
    }

    let chunk_size = 60usize;
    let overlap = 12usize;
    let mut i = 0;

    while i < lines.len() {
        let end = (i + chunk_size).min(lines.len());
        let chunk_content = lines[i..end].join("\n");
        if !chunk_content.trim().is_empty() {
            chunks.push(Chunk {
                file_path: path.to_string_lossy().to_string(),
                content: chunk_content,
                start_line: i + 1,
                end_line: end,
            });
        }
        if end == lines.len() {
            break;
        }
        i += chunk_size - overlap;
    }
    chunks
}

pub fn chunk_directory(dir_path: &Path) -> Vec<Chunk> {
    let mut all_chunks = Vec::new();
    let walker = WalkBuilder::new(dir_path)
        .hidden(true)
        .git_ignore(true)
        .build();

    let valid_exts = [
        "rs", "py", "js", "ts", "jsx", "tsx", "go", "java", "c", "cpp", "h", "hpp", "cs",
        "php", "swift", "kt", "md", "txt", "json", "toml", "yaml", "yml", "html", "css",
    ];

    for result in walker {
        if let Ok(entry) = result {
            let path = entry.path().to_owned();
            if path.is_file() {
                if let Some(ext) = path.extension().and_then(|e| e.to_str()) {
                    if valid_exts.contains(&ext) {
                        all_chunks.extend(chunk_file(&path));
                    }
                }
            }
        }
    }
    all_chunks
}

pub struct VectorStore {
    pub records: RwLock<Vec<VectorRecord>>,
    pub client: Client,
    pub embed_model: String,
    pub index_path: PathBuf,
}

impl VectorStore {
    pub fn new() -> Arc<Self> {
        let index_path = dirs_next::data_local_dir()
            .unwrap_or_else(|| PathBuf::from("."))
            .join("LocalCortex")
            .join("index.json");

        let records = if index_path.exists() {
            std::fs::read_to_string(&index_path)
                .ok()
                .and_then(|s| serde_json::from_str::<PersistedStore>(&s).ok())
                .map(|p| p.records)
                .unwrap_or_default()
        } else {
            Vec::new()
        };

        Arc::new(Self {
            records: RwLock::new(records),
            client: Client::new(),
            embed_model: "nomic-embed-text".to_string(),
            index_path,
        })
    }

    pub async fn embed_text(&self, text: &str) -> Result<Vec<f32>, String> {
        let req = OllamaEmbedRequest {
            model: self.embed_model.clone(),
            prompt: text.to_string(),
        };
        let res = self
            .client
            .post("http://127.0.0.1:11434/api/embeddings")
            .json(&req)
            .send()
            .await
            .map_err(|e| e.to_string())?;
        let json: OllamaEmbedResponse = res.json().await.map_err(|e| e.to_string())?;
        Ok(json.embedding)
    }

    pub async fn clear_directory(&self, dir: &str) {
        let mut records = self.records.write().await;
        records.retain(|r| !r.chunk.file_path.starts_with(dir));
    }

    pub async fn add_chunks<F>(&self, chunks: Vec<Chunk>, progress_cb: F) -> Result<(), String>
    where
        F: Fn(usize, usize) + Send + Sync,
    {
        let total = chunks.len();
        let mut done = 0usize;

        for chunk in &chunks {
            if let Ok(emb) = self.embed_text(&chunk.content).await {
                let mut records = self.records.write().await;
                records.push(VectorRecord {
                    chunk: chunk.clone(),
                    embedding: emb,
                });
            }
            done += 1;
            progress_cb(done, total);
        }
        Ok(())
    }

    pub async fn save(&self) -> Result<(), String> {
        let records = self.records.read().await;
        let persisted = PersistedStore {
            records: records.clone(),
        };
        if let Some(parent) = self.index_path.parent() {
            std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        let json = serde_json::to_string(&persisted).map_err(|e| e.to_string())?;
        std::fs::write(&self.index_path, json).map_err(|e| e.to_string())?;
        Ok(())
    }

    pub async fn record_count(&self) -> usize {
        self.records.read().await.len()
    }

    pub async fn search_in_directory(
        &self,
        query: &str,
        k: usize,
        dir: &Path,
    ) -> Result<Vec<(Chunk, f32)>, String> {
        let query_emb = self.embed_text(query).await?;
        let dir_prefix = dir.to_string_lossy().to_string();
        let records = self.records.read().await;

        if records.is_empty() {
            return Ok(Vec::new());
        }

        let mut results: Vec<(Chunk, f32)> = records
            .par_iter()
            .filter(|record| record.chunk.file_path.starts_with(&dir_prefix))
            .map(|record| {
                let score = cosine_similarity(&query_emb, &record.embedding);
                (record.chunk.clone(), score)
            })
            .collect();

        results.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));
        Ok(results.into_iter().take(k).collect())
    }

    pub async fn search(
        &self,
        query: &str,
        k: usize,
        active_file: Option<&str>,
        recent_files: &[String],
    ) -> Result<Vec<(Chunk, f32)>, String> {
        let query_emb = self.embed_text(query).await?;
        let records = self.records.read().await;

        if records.is_empty() {
            return Ok(Vec::new());
        }

        let mut results: Vec<(Chunk, f32)> = records
            .par_iter()
            .map(|record| {
                let mut score = cosine_similarity(&query_emb, &record.embedding);

                if let Some(af) = active_file {
                    if record.chunk.file_path == af {
                        score *= 1.5;
                    }
                }
                if recent_files.iter().any(|rf| rf == &record.chunk.file_path) {
                    score *= 1.2;
                }

                (record.chunk.clone(), score)
            })
            .collect();

        results.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));
        Ok(results.into_iter().take(k).collect())
    }
}

fn cosine_similarity(a: &[f32], b: &[f32]) -> f32 {
    if a.len() != b.len() {
        return 0.0;
    }

    let mut dot = 0.0f32;
    let mut norm_a = 0.0f32;
    let mut norm_b = 0.0f32;
    for i in 0..a.len() {
        dot += a[i] * b[i];
        norm_a += a[i] * a[i];
        norm_b += b[i] * b[i];
    }

    if norm_a == 0.0 || norm_b == 0.0 {
        return 0.0;
    }

    dot / (norm_a.sqrt() * norm_b.sqrt())
}
