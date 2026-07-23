use std::time::Duration;

use serde::{Deserialize, Serialize};

const MAX_REQUEST_BODY: usize = 1024 * 1024;
const MAX_RESPONSE_BODY: usize = 5 * 1024 * 1024;
const MAX_TIMEOUT_MS: u64 = 30_000;
const DEFAULT_TIMEOUT_MS: u64 = 15_000;
const MAX_REDIRECTS: usize = 3;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModuleHttpRequest {
    pub url: String,
    #[serde(default = "default_method")]
    pub method: String,
    #[serde(default)]
    pub headers: Vec<(String, String)>,
    #[serde(default)]
    pub body: Option<Vec<u8>>,
    #[serde(default)]
    pub timeout_ms: Option<u64>,
}

fn default_method() -> String {
    "GET".to_string()
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModuleHttpResponse {
    pub status: u16,
    pub headers: Vec<(String, String)>,
    pub body: Vec<u8>,
    pub truncated: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HttpProxyResult {
    pub module_id: String,
    pub response: Option<ModuleHttpResponse>,
    pub error: Option<String>,
}

pub fn origin_of(url: &str) -> Result<String, String> {
    let parsed = url::Url::parse(url).map_err(|error| format!("invalid URL: {error}"))?;
    if parsed.scheme() != "https" {
        return Err("only https URLs are allowed".into());
    }
    let host = parsed.host_str().ok_or("URL has no host")?;
    Ok(format!("https://{host}"))
}

pub fn is_private_host(host: &str) -> bool {
    if host == "localhost" || host == "127.0.0.1" || host == "::1" || host == "0.0.0.0" {
        return true;
    }
    if let Ok(ip) = host.parse::<std::net::IpAddr>() {
        return ip.is_loopback() || ip.is_unspecified() || is_private_ip(&ip);
    }
    false
}

fn is_private_ip(ip: &std::net::IpAddr) -> bool {
    match ip {
        std::net::IpAddr::V4(v4) => v4.is_private() || v4.is_link_local() || v4.is_broadcast(),
        std::net::IpAddr::V6(v6) => v6.is_loopback() || v6.is_unspecified() || (v6.segments()[0] & 0xfe00) == 0xfc00,
    }
}

pub fn validate_request(request: &ModuleHttpRequest, allowed_origins: &[String]) -> Result<(), String> {
    let method = request.method.to_ascii_uppercase();
    if !matches!(method.as_str(), "GET" | "POST" | "PUT" | "PATCH" | "DELETE") {
        return Err(format!("unsupported HTTP method: {method}"));
    }
    let origin = origin_of(&request.url)?;
    if !allowed_origins.contains(&origin) {
        return Err(format!("origin not allowed: {origin}"));
    }
    let parsed = url::Url::parse(&request.url).map_err(|error| format!("invalid URL: {error}"))?;
    if let Some(host) = parsed.host_str()
        && is_private_host(host)
    {
        return Err("private host addresses are not allowed".into());
    }
    if let Some(body) = &request.body
        && body.len() > MAX_REQUEST_BODY
    {
        return Err("request body too large".into());
    }
    for (name, _value) in &request.headers {
        let lower = name.to_ascii_lowercase();
        if matches!(lower.as_str(), "cookie" | "set-cookie" | "host" | "authorization") {
            return Err(format!("forbidden header: {name}"));
        }
    }
    Ok(())
}

pub fn execute_request(module_id: &str, allowed_origins: &[String], request: ModuleHttpRequest) -> Result<HttpProxyResult, String> {
    if let Err(error) = validate_request(&request, allowed_origins) {
        return Ok(HttpProxyResult { module_id: module_id.into(), response: None, error: Some(error) });
    }
    let timeout_ms = request.timeout_ms.unwrap_or(DEFAULT_TIMEOUT_MS).min(MAX_TIMEOUT_MS);
    let method = method_from_str(&request.method);
    let client = reqwest::blocking::Client::builder()
        .timeout(Duration::from_millis(timeout_ms))
        .redirect(reqwest::redirect::Policy::limited(MAX_REDIRECTS))
        .build()
        .map_err(|error| format!("build http client: {error}"))?;
    let mut request_builder = client.request(method, &request.url);
    for (name, value) in &request.headers {
        request_builder = request_builder.header(name, value);
    }
    if let Some(body) = &request.body {
        request_builder = request_builder.body(body.clone());
    }
    let response = request_builder.send().map_err(|error| format!("http request failed: {error}"))?;
    let status = response.status().as_u16();
    let headers = response.headers().iter()
        .map(|(name, value)| (name.as_str().to_string(), value.to_str().unwrap_or("").to_string()))
        .collect::<Vec<_>>();
    let body = response.bytes().map_err(|error| format!("read response body: {error}"))?;
    let (body, truncated) = if body.len() > MAX_RESPONSE_BODY {
        (body[..MAX_RESPONSE_BODY].to_vec(), true)
    } else {
        (body.to_vec(), false)
    };
    Ok(HttpProxyResult { module_id: module_id.into(), response: Some(ModuleHttpResponse { status, headers, body, truncated }), error: None })
}

fn method_from_str(method: &str) -> reqwest::Method {
    match method.to_ascii_uppercase().as_str() {
        "GET" => reqwest::Method::GET,
        "POST" => reqwest::Method::POST,
        "PUT" => reqwest::Method::PUT,
        "PATCH" => reqwest::Method::PATCH,
        "DELETE" => reqwest::Method::DELETE,
        _ => reqwest::Method::GET,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extracts_https_origin() {
        assert_eq!(origin_of("https://api.example.com/v1/data").unwrap(), "https://api.example.com");
        assert!(origin_of("http://api.example.com").is_err());
        assert!(origin_of("not-a-url").is_err());
    }

    #[test]
    fn detects_private_hosts() {
        assert!(is_private_host("127.0.0.1"));
        assert!(is_private_host("localhost"));
        assert!(is_private_host("10.0.0.1"));
        assert!(is_private_host("192.168.1.1"));
        assert!(!is_private_host("api.example.com"));
    }

    #[test]
    fn validates_request_against_allowed_origins() {
        let request = ModuleHttpRequest {
            url: "https://api.example.com/v1".into(), method: "GET".into(),
            headers: vec![], body: None, timeout_ms: None,
        };
        assert!(validate_request(&request, &["https://api.example.com".into()]).is_ok());
        assert!(validate_request(&ModuleHttpRequest { url: "https://other.example.com".into(), ..request.clone() }, &["https://api.example.com".into()]).is_err());
        assert!(validate_request(&ModuleHttpRequest { url: "https://127.0.0.1".into(), ..request.clone() }, &["https://127.0.0.1".into()]).is_err());
        assert!(validate_request(&ModuleHttpRequest { method: "TRACE".into(), ..request.clone() }, &["https://api.example.com".into()]).is_err());
        assert!(validate_request(&ModuleHttpRequest { headers: vec![("Cookie".into(), "x".into())], ..request.clone() }, &["https://api.example.com".into()]).is_err());
    }


}
