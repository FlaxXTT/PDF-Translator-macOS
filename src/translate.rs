use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

use futures_util::{StreamExt, stream};
use reqwest::{
    Client, RequestBuilder, Response, StatusCode, Url, header::CONTENT_TYPE, redirect::Policy,
};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use tokio::sync::OnceCell;

use crate::workbench::Options;

#[path = "translation_recovery.rs"]
mod recovery;

const ENDPOINTS: [&str; 2] = [
    "https://api1.pdf2zh-next.com/chatproxy",
    "https://api2.pdf2zh-next.com/chatproxy",
];
const MAX_SPLIT_DEPTH: u8 = 3;

#[derive(Clone, Default, Deserialize, Serialize, PartialEq, Eq)]
pub(crate) enum Service {
    #[default]
    SiliconFlowFree,
    Custom {
        name: String,
        base_url: String,
        model: String,
        #[serde(default, skip_serializing)]
        key: String,
    },
}

impl Service {
    pub(crate) fn describe(&self) -> Value {
        match self {
            Self::SiliconFlowFree => {
                json!({"name":"SiliconFlowFree", "base_url":"", "model":"", "has_key":false})
            }
            Self::Custom {
                name,
                base_url,
                model,
                key,
            } => {
                json!({"name":name, "base_url":base_url, "model":model, "has_key":!key.is_empty()})
            }
        }
    }
}

pub(crate) struct Translator {
    service: Service,
    client: Client,
    free_endpoints: OnceCell<[&'static str; 2]>,
}

pub(crate) struct SegmentTranslation {
    pub(crate) text: String,
    pub(crate) kept_source: bool,
}

pub(crate) enum CompletionError {
    Incomplete,
    Failed(String),
}

impl Translator {
    pub(crate) fn new(service: Service) -> Result<Self, String> {
        let client = Client::builder()
            .user_agent("Hermeneuein")
            .connect_timeout(Duration::from_secs(8))
            .timeout(Duration::from_secs(60))
            .redirect(Policy::none())
            .build()
            .map_err(|_| "Could not initialize the translation service.")?;
        Ok(Self {
            service,
            client,
            free_endpoints: OnceCell::new(),
        })
    }

    pub(crate) async fn batch(
        &self,
        texts: &[String],
        terms: &[(String, String)],
        opts: &Options,
        cancelled: &AtomicBool,
    ) -> Result<Vec<SegmentTranslation>, String> {
        let glossary = terms
            .iter()
            .map(|(source, target)| format!("{source} → {target}"))
            .collect::<Vec<_>>()
            .join("\n");
        let parallelism = if matches!(self.service, Service::SiliconFlowFree) {
            2
        } else {
            8
        };
        let mut requests = std::pin::pin!(
            stream::iter(
                texts
                    .iter()
                    .map(|text| self.translate(text, &glossary, opts, cancelled, 0))
            )
            .buffered(parallelism)
        );
        let mut translated = Vec::with_capacity(texts.len());
        while let Some(next) = requests.next().await {
            translated.push(next?);
        }
        Ok(translated)
    }

    async fn translate(
        &self,
        text: &str,
        glossary: &str,
        opts: &Options,
        cancelled: &AtomicBool,
        depth: u8,
    ) -> Result<SegmentTranslation, String> {
        if cancelled.load(Ordering::Relaxed) {
            return Err("Canceled".into());
        }
        if text.trim().is_empty() {
            return Ok(SegmentTranslation {
                text: text.to_owned(),
                kept_source: false,
            });
        }
        match self.translate_once(text, glossary, opts, cancelled).await {
            Ok(reply) if !recovery::looks_incomplete(text, &reply, depth > 0) => {
                return Ok(SegmentTranslation {
                    text: reply,
                    kept_source: false,
                });
            }
            Ok(_) | Err(CompletionError::Incomplete) => {}
            Err(CompletionError::Failed(error)) => return Err(error),
        }

        // Never export a partial reply. Preserve the original only for a piece
        // that still fails after bounded, paragraph-local recovery.
        if depth < MAX_SPLIT_DEPTH
            && let Some((left, separator, right)) = recovery::split(text)
        {
            let left = Box::pin(self.translate(left, glossary, opts, cancelled, depth + 1)).await?;
            let right =
                Box::pin(self.translate(right, glossary, opts, cancelled, depth + 1)).await?;
            return Ok(SegmentTranslation {
                text: [left.text.as_str(), separator, right.text.as_str()].concat(),
                kept_source: left.kept_source || right.kept_source,
            });
        }
        Ok(SegmentTranslation {
            text: text.to_owned(),
            kept_source: true,
        })
    }

    async fn translate_once(
        &self,
        text: &str,
        glossary: &str,
        opts: &Options,
        cancelled: &AtomicBool,
    ) -> Result<String, CompletionError> {
        if matches!(self.service, Service::SiliconFlowFree) {
            let target = if opts.to == "zh-CN" { "zh" } else { &opts.to };
            let mut prompt = format!(
                "You are a professional,authentic machine translation engine.\n\n;; Treat next line as plain text input and translate it into {target}, output translation ONLY. If translation is unnecessary (e.g. proper nouns, codes), return the original text. NO explanations. NO notes."
            );
            if !glossary.is_empty() {
                prompt.push_str("\nUse these terminology translations where appropriate:\n");
                prompt.push_str(glossary);
            }
            let system = opts.prompt.trim();
            if !system.is_empty() {
                prompt.push_str("\nAdditional translation instructions: ");
                prompt.push_str(system);
            }
            if glossary.is_empty() && system.is_empty() {
                prompt.push_str(" Input:\n\n");
            } else {
                prompt.push_str("\nInput:\n\n");
            }
            prompt.push_str(text);
            return self.complete(&prompt, "", false, cancelled).await;
        }
        let from = language(&opts.from);
        let to = language(&opts.to);
        let mut prompt = format!(
            "Translate this PDF text from {from} into {to}. Output only the translated text. Preserve mathematical formulas and every [[BD_F_N]], [[BD_L_N]], [[BD_R_N]] placeholder exactly."
        );
        if !glossary.is_empty() {
            prompt.push_str("\nUse these terminology translations where appropriate:\n");
            prompt.push_str(glossary);
        }
        prompt.push_str("\nInput:\n\n");
        prompt.push_str(text);
        self.complete(&prompt, opts.prompt.trim(), false, cancelled)
            .await
    }

    pub(crate) async fn extract_terms(
        &self,
        prompt: &str,
        opts: &Options,
        cancelled: &AtomicBool,
    ) -> Result<String, String> {
        self.complete(prompt, "", opts.json_mode, cancelled)
            .await
            .map_err(|error| match error {
                CompletionError::Incomplete => "The translation service returned an incomplete glossary.".into(),
                CompletionError::Failed(error) => error,
            })
    }

    async fn complete(
        &self,
        prompt: &str,
        system: &str,
        structured: bool,
        cancelled: &AtomicBool,
    ) -> Result<String, CompletionError> {
        let request = async {
            match &self.service {
                Service::SiliconFlowFree => {
                    let combined;
                    let prompt = if system.is_empty() {
                        prompt
                    } else {
                        combined =
                            format!("{prompt}\n\nAdditional translation instructions: {system}");
                        &combined
                    };
                    self.free(prompt, structured).await
                }
                Service::Custom {
                    base_url,
                    model,
                    key,
                    ..
                } => {
                    let messages = if system.is_empty() {
                        json!([{"role":"user", "content":prompt}])
                    } else {
                        json!([{"role":"system", "content":system}, {"role":"user", "content":prompt}])
                    };
                    let response = completion_request(&self.client, base_url, model, key, messages)
                        .send()
                        .await
                        .map_err(|error| CompletionError::Failed(network_error(error)))?;
                    if !response.status().is_success() {
                        return Err(request_failure(response).await);
                    }
                    read_custom_response(response).await
                }
            }
        };
        tokio::select! {
            value = request => value,
            _ = wait_for_cancellation(cancelled) => Err(CompletionError::Failed("Canceled".into())),
        }
    }

    async fn free(&self, prompt: &str, json_mode: bool) -> Result<String, CompletionError> {
        let endpoints = self
            .free_endpoints
            .get_or_init(|| async {
                let (first, second) =
                    tokio::join!(self.health(ENDPOINTS[0]), self.health(ENDPOINTS[1]));
                if second.is_some() && (first.is_none() || second < first) {
                    [ENDPOINTS[1], ENDPOINTS[0]]
                } else {
                    ENDPOINTS
                }
            })
            .await;
        let mut last_error = "SiliconFlow Free is temporarily unavailable.".to_owned();
        for (attempt, endpoint) in endpoints.iter().cycle().take(4).enumerate() {
            if attempt >= 2 {
                tokio::time::sleep(Duration::from_secs(3)).await;
            }
            let request = if json_mode {
                json!({"text": prompt, "requestJsonMode": true})
            } else {
                json!({"text": prompt})
            };
            let response = match self
                .client
                .post(*endpoint)
                .timeout(Duration::from_secs(42))
                .json(&request)
                .send()
                .await
            {
                Ok(response) => response,
                Err(error) => {
                    last_error = network_error(error);
                    continue;
                }
            };
            let status = response.status();
            if !status.is_success() {
                let CompletionError::Failed(error) = request_failure(response).await else {
                    return Err(CompletionError::Incomplete);
                };
                last_error = error;
                if status.as_u16() == 400
                    || status == StatusCode::TOO_MANY_REQUESTS
                    || status.is_server_error()
                {
                    continue;
                }
                return Err(CompletionError::Failed(last_error));
            }
            let reply: Value = response
                .json()
                .await
                .map_err(|error| CompletionError::Failed(network_error(error)))?;
            return reply_text(&reply, &reply["content"]);
        }
        Err(CompletionError::Failed(last_error))
    }

    async fn health(&self, endpoint: &str) -> Option<Duration> {
        let start = std::time::Instant::now();
        let response = self
            .client
            .post(format!("{endpoint}/check"))
            .timeout(Duration::from_secs(5))
            .send()
            .await
            .ok()?;
        if !response.status().is_success() {
            return None;
        }
        let status: Value = response.json().await.ok()?;
        (status["status"].as_str() == Some("ok")).then(|| start.elapsed())
    }
}

pub(crate) fn completion_request(
    client: &Client,
    base_url: &str,
    model: &str,
    key: &str,
    messages: Value,
) -> RequestBuilder {
    let mut payload = json!({"model":model, "messages":messages, "stream":false});
    // DeepSeek's Flash and V4 models default to billable reasoning, which a
    // translation request does not need. Other gateways use different flags.
    if Url::parse(base_url).is_ok_and(|url| url.host_str() == Some("api.deepseek.com"))
        && matches!(
            model,
            "deepseek-flash" | "deepseek-v4-flash" | "deepseek-v4-pro"
        )
    {
        payload["thinking"] = json!({"type":"disabled"});
    }
    let request = client
        .post(format!("{base_url}/chat/completions"))
        .json(&payload);
    if key.is_empty() {
        request
    } else {
        request.bearer_auth(key)
    }
}

pub(crate) async fn read_custom_response(response: Response) -> Result<String, CompletionError> {
    let streaming = response
        .headers()
        .get(CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.split(';').next())
        .is_some_and(|mime| mime.trim().eq_ignore_ascii_case("text/event-stream"));
    if streaming {
        return read_stream(response).await;
    }
    let reply: Value = response
        .json()
        .await
        .map_err(|error| CompletionError::Failed(network_error(error)))?;
    reply_text(&reply, &reply["choices"][0]["message"]["content"])
}

async fn read_stream(mut response: Response) -> Result<String, CompletionError> {
    const MAX_STREAM_BYTES: usize = 8 * 1024 * 1024;
    let invalid_stream = || {
        CompletionError::Failed(
            "The translation service returned an invalid streaming response.".into(),
        )
    };
    let mut total_bytes = 0;
    let mut line = Vec::new();
    let mut event = Vec::new();
    let mut answer = String::new();
    let mut finished = false;
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|error| CompletionError::Failed(network_error(error)))?
    {
        total_bytes += chunk.len();
        if total_bytes > MAX_STREAM_BYTES {
            return Err(invalid_stream());
        }
        for piece in chunk.split_inclusive(|byte| *byte == b'\n') {
            line.extend_from_slice(piece);
            if !line.ends_with(b"\n") {
                continue;
            }
            let field = line.strip_suffix(b"\n").unwrap();
            let field = field.strip_suffix(b"\r").unwrap_or(field);
            if let Some(value) = field.strip_prefix(b"data:") {
                if !event.is_empty() {
                    event.push(b'\n');
                }
                event.extend_from_slice(value.strip_prefix(b" ").unwrap_or(value));
            } else if field.is_empty() && !event.is_empty() {
                if event == b"[DONE]" {
                    return final_text(&answer);
                }
                let reply: Value = serde_json::from_slice(&event).map_err(|_| invalid_stream())?;
                check_reply(&reply)?;
                let choice = &reply["choices"][0];
                if let Some(text) = choice["delta"]["content"].as_str() {
                    answer.push_str(text);
                }
                finished |= choice["finish_reason"].as_str() == Some("stop");
                event.clear();
            }
            line.clear();
        }
    }
    if !finished || !line.is_empty() || !event.is_empty() {
        return Err(CompletionError::Incomplete);
    }
    final_text(&answer)
}

fn reply_text(reply: &Value, content: &Value) -> Result<String, CompletionError> {
    check_reply(reply)?;
    final_text(content.as_str().unwrap_or_default())
}

fn check_reply(reply: &Value) -> Result<(), CompletionError> {
    let choice = &reply["choices"][0];
    let reasons = [
        &choice["finish_reason"],
        &choice["finishReason"],
        &reply["finish_reason"],
        &reply["finishReason"],
        &reply["stop_reason"],
        &reply["stopReason"],
        &reply["incomplete_details"]["reason"],
    ];
    if reasons
        .iter()
        .filter_map(|value| value.as_str())
        .any(|reason| {
            ["length", "max_tokens", "max_output_tokens"]
                .iter()
                .any(|limit| reason.eq_ignore_ascii_case(limit))
        })
        || [&reply["error"]["code"], &reply["error"]["message"]]
            .into_iter()
            .filter_map(Value::as_str)
            .any(is_context_limit)
    {
        return Err(CompletionError::Incomplete);
    }
    if !reply["error"].is_null() || choice["finish_reason"].as_str() == Some("content_filter") {
        return Err(CompletionError::Failed(
            "The translation service did not return usable text.".into(),
        ));
    }
    Ok(())
}

async fn request_failure(response: Response) -> CompletionError {
    let status = response.status();
    if status == StatusCode::PAYLOAD_TOO_LARGE
        || (matches!(
            status,
            StatusCode::BAD_REQUEST | StatusCode::UNPROCESSABLE_ENTITY
        ) && response
            .text()
            .await
            .is_ok_and(|body| is_context_limit(&body)))
    {
        return CompletionError::Incomplete;
    }
    CompletionError::Failed(service_error(status))
}

fn is_context_limit(body: &str) -> bool {
    let body = body.to_ascii_lowercase();
    [
        "context_length_exceeded",
        "context_window_exceeded",
        "maximum context length",
        "exceeds the context window",
        "context length exceeded",
        "input is too long",
        "input too long",
        "prompt is too long",
        "maximum input length",
    ]
    .iter()
    .any(|signal| body.contains(signal))
}

pub(crate) async fn wait_for_cancellation(cancelled: &AtomicBool) {
    while !cancelled.load(Ordering::Relaxed) {
        tokio::time::sleep(Duration::from_millis(70)).await;
    }
}

fn service_error(status: StatusCode) -> String {
    match status.as_u16() {
        401 | 403 => "Authentication failed. Check your API key and model access.".into(),
        429 => "The translation service is rate limiting requests. Try again later.".into(),
        code => format!("The translation service returned HTTP {code}."),
    }
}

fn network_error(error: reqwest::Error) -> String {
    if error.is_timeout() {
        "The translation service timed out."
    } else if error.is_decode() {
        "The translation service returned an invalid response."
    } else {
        "Could not connect to the translation service."
    }
    .into()
}

fn final_text(raw: &str) -> Result<String, CompletionError> {
    let mut text = raw.trim();
    let mut removed_reasoning = false;
    loop {
        if let Some(inner) = text
            .strip_prefix("```text\n")
            .or_else(|| text.strip_prefix("```json\n"))
            .or_else(|| text.strip_prefix("```\n"))
            .and_then(|value| value.strip_suffix("```"))
            .or_else(|| {
                text.strip_prefix("<answer>")
                    .and_then(|value| value.strip_suffix("</answer>"))
            })
        {
            text = inner.trim();
        } else if let Some(reasoning) = text.strip_prefix("<think>") {
            let Some((_, answer)) = reasoning.split_once("</think>") else {
                return Err(CompletionError::Incomplete);
            };
            removed_reasoning = true;
            text = answer.trim();
        } else if let Some(answer) = text.strip_prefix("</think>") {
            removed_reasoning = true;
            text = answer.trim();
        } else {
            break;
        }
    }
    if removed_reasoning && text.is_empty() {
        return Err(CompletionError::Incomplete);
    }
    if text.is_empty() {
        return Err(CompletionError::Failed(
            "The translation service did not return usable text.".into(),
        ));
    }
    Ok(text.into())
}

fn language(code: &str) -> &str {
    match code {
        "auto" => "the detected source language",
        "zh" | "zh-CN" => "Simplified Chinese",
        "zh-TW" => "Traditional Chinese (Taiwan)",
        "zh-HK" => "Traditional Chinese (Hong Kong)",
        "en" => "English",
        "ja" => "Japanese",
        "ko" => "Korean",
        "fr" => "French",
        "de" => "German",
        "es" => "Spanish",
        "it" => "Italian",
        "pt" => "Portuguese",
        "ru" => "Russian",
        code => code,
    }
}

#[cfg(test)]
mod tests {
    use std::sync::{Arc, Mutex};

    use super::{
        CompletionError, Service, Translator, completion_request, final_text, is_context_limit,
        reply_text,
    };
    use crate::network::test_provider;
    use crate::workbench::Options;
    use futures_util::StreamExt;
    use serde_json::{Value, json};

    #[test]
    fn reads_length_limits_from_openai_choices_and_proxy_replies() {
        let standard = json!({"choices": [{
            "message": {"content": "A nonempty prefix"},
            "finish_reason": "length",
        }]});
        assert!(matches!(
            reply_text(&standard, &standard["choices"][0]["message"]["content"]),
            Err(CompletionError::Incomplete)
        ));
        let proxy = json!({"content": "一段译文的开头", "finishReason": "MAX_TOKENS"});
        assert!(matches!(
            reply_text(&proxy, &proxy["content"]),
            Err(CompletionError::Incomplete)
        ));
        let stopped = json!({"content": "完整译文。"});
        assert_eq!(
            reply_text(&stopped, &stopped["content"]).ok().as_deref(),
            Some("完整译文。")
        );
    }

    #[test]
    fn classifies_context_errors_without_folding_other_bad_requests_into_recovery() {
        assert!(is_context_limit(
            r#"{"error":{"code":"context_length_exceeded"}}"#
        ));
        assert!(is_context_limit(
            "This model's maximum context length is 4096 tokens."
        ));
        assert!(!is_context_limit(r#"{"error":{"code":"invalid_model"}}"#));
        assert!(!is_context_limit(
            "The max_tokens parameter must be positive."
        ));
    }

    #[test]
    fn removes_model_wrappers_and_keeps_unfinished_thinking_out_of_translation() {
        assert_eq!(
            final_text("<think>Reasoning</think>\n<answer>译文。</answer>")
                .ok()
                .as_deref(),
            Some("译文。")
        );
        assert_eq!(
            final_text("```text\n<answer>译文。</answer>\n```")
                .ok()
                .as_deref(),
            Some("译文。")
        );
        assert_eq!(
            final_text("原文讨论 <answer> 和 </answer> 标签。")
                .ok()
                .as_deref(),
            Some("原文讨论 <answer> 和 </answer> 标签。")
        );
        assert_eq!(
            final_text("原文讨论 <think> 和 </think> 标签。")
                .ok()
                .as_deref(),
            Some("原文讨论 <think> 和 </think> 标签。")
        );
        for reasoning in ["<think>Reasoning", "<think>Reasoning</think>"] {
            assert!(matches!(
                final_text(reasoning),
                Err(CompletionError::Incomplete)
            ));
        }
    }

    #[test]
    fn disables_reasoning_for_supported_official_deepseek_models_only() {
        let client = reqwest::Client::new();
        for (base_url, model, thinking_disabled) in [
            ("https://api.deepseek.com", "deepseek-flash", true),
            ("https://api.deepseek.com/v1", "deepseek-v4-pro", true),
            ("https://api.deepseek.com", "deepseek-reasoner", false),
            ("https://gateway.example/v1", "deepseek-flash", false),
        ] {
            let request = completion_request(&client, base_url, model, "dummy", json!([]))
                .build()
                .unwrap();
            let payload: Value =
                serde_json::from_slice(request.body().unwrap().as_bytes().unwrap()).unwrap();
            assert_eq!(payload["stream"], false);
            assert_eq!(
                payload["thinking"]["type"].as_str(),
                thinking_disabled.then_some("disabled")
            );
        }
    }

    #[test]
    fn keyless_local_service_works_for_connection_test_and_streaming_translation() {
        tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap()
            .block_on(async {
                use axum::{body::Body, http::HeaderMap, response::Response};

                let requests = Arc::new(std::sync::atomic::AtomicUsize::new(0));
                let calls = Arc::clone(&requests);
                let route = axum::routing::post(
                    move |headers: HeaderMap, axum::Json(payload): axum::Json<Value>| {
                        let calls = Arc::clone(&calls);
                        async move {
                            assert!(!headers.contains_key("authorization"));
                            assert_eq!(payload["stream"], false);
                            calls.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
                            let frames = concat!(
                                ": keepalive\r\n\r\n",
                                "data: {\"choices\":[{\"delta\":{\"reasoning_content\":\"private\"}}]}\r\n\r\n",
                                "data: {\"choices\":[{\"delta\":{\"content\":\"<answer>译\"}}]}\n\n",
                                "data: {\"choices\":[{\"delta\":{\"content\":\"文。</answer>\"},\"finish_reason\":\"stop\"}]}\n\n",
                                "data: [DONE]\n\n",
                            );
                            let split = frames.find("译").unwrap() + 1;
                            let chunks = [0..split, split..frames.len()].into_iter().map(|range| {
                                Ok::<_, std::convert::Infallible>(&frames.as_bytes()[range])
                            });
                            Response::builder()
                                .header("content-type", "text/event-stream; charset=utf-8")
                                .body(Body::from_stream(
                                    futures_util::stream::iter(chunks)
                                        .chain(futures_util::stream::pending()),
                                ))
                                .unwrap()
                        }
                    },
                );
                let listener = tokio::net::TcpListener::bind(("127.0.0.1", 0)).await.unwrap();
                let base_url = format!("http://{}/v1", listener.local_addr().unwrap());
                let server = tokio::spawn(async move {
                    axum::serve(listener, axum::Router::new().route("/v1/chat/completions", route))
                        .await
                        .unwrap();
                });
                tokio::time::timeout(
                    std::time::Duration::from_secs(2),
                    test_provider(&base_url, "local", ""),
                )
                .await
                .unwrap()
                .unwrap();
                let mut translator = Translator::new(Service::Custom {
                    name: "Local".into(),
                    base_url,
                    model: "local".into(),
                    key: String::new(),
                })
                .unwrap();
                translator.client = reqwest::Client::builder().no_proxy().build().unwrap();
                let results = tokio::time::timeout(
                    std::time::Duration::from_secs(2),
                    translator.batch(
                        &["Text.".into()],
                        &[],
                        &Options::default(),
                        &std::sync::atomic::AtomicBool::new(false),
                    ),
                )
                .await
                .unwrap()
                .unwrap();
                assert_eq!(results[0].text, "译文。");
                assert_eq!(requests.load(std::sync::atomic::Ordering::Relaxed), 2);
                server.abort();
            });
    }

    #[test]
    fn free_gateway_recovers_a_short_reply_without_replaying_healthy_paragraphs() {
        tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap()
            .block_on(async {
                let source =
                    "This original sentence must remain present in the recovered paragraph. "
                        .repeat(12)
                        .trim_end()
                        .to_owned();
                let sibling = "This nearby paragraph already has a complete reply.".to_owned();
                let calls = Arc::new(Mutex::new(Vec::new()));
                let received = Arc::clone(&calls);
                let incomplete_input = source.clone();
                let route = axum::routing::post(move |axum::Json(request): axum::Json<Value>| {
                    let received = Arc::clone(&received);
                    let incomplete_input = incomplete_input.clone();
                    async move {
                        let (instructions, input) = request["text"]
                            .as_str()
                            .unwrap()
                            .split_once("Input:\n\n")
                            .unwrap();
                        assert!(instructions.contains("paragraph → 段落"));
                        assert!(instructions.contains("Use the technical register."));
                        received.lock().unwrap().push(input.to_owned());
                        axum::Json(json!({
                            "content": if input == incomplete_input { "译文尚未" } else { input },
                        }))
                    }
                });
                let listener = tokio::net::TcpListener::bind(("127.0.0.1", 0))
                    .await
                    .unwrap();
                let endpoint: &'static str =
                    format!("http://{}/chatproxy", listener.local_addr().unwrap()).leak();
                let server = tokio::spawn(async move {
                    axum::serve(listener, axum::Router::new().route("/chatproxy", route))
                        .await
                        .unwrap();
                });
                let mut translator = Translator::new(Service::SiliconFlowFree).unwrap();
                translator.client = reqwest::Client::builder().no_proxy().build().unwrap();
                translator.free_endpoints.set([endpoint, endpoint]).unwrap();
                let results = translator
                    .batch(
                        &[source.clone(), sibling.clone()],
                        &[("paragraph".into(), "段落".into())],
                        &Options {
                            prompt: "Use the technical register.".into(),
                            ..Options::default()
                        },
                        &std::sync::atomic::AtomicBool::new(false),
                    )
                    .await
                    .unwrap();
                assert_eq!(results[0].text, source);
                assert!(!results[0].kept_source);
                assert_eq!(results[1].text, sibling);
                let calls = calls.lock().unwrap();
                assert_eq!(calls.len(), 4);
                assert_eq!(calls.iter().filter(|call| **call == source).count(), 1);
                assert_eq!(calls.iter().filter(|call| **call == sibling).count(), 1);
                server.abort();
            });
    }
}
