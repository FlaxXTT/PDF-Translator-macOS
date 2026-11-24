use std::collections::BTreeMap;
use std::fs::{self, File, OpenOptions};
use std::io::{self, Write};
use std::net::IpAddr;
use std::path::Path;

use serde::{Deserialize, Serialize};
use tempfile::NamedTempFile;

use crate::network::http_url;

const READ_ERROR: &str = "The saved service configuration is invalid. Check it and try again.";
const WRITE_ERROR: &str = "Could not save the service configuration.";
const MISSING_PROFILE: &str = "Select a saved service first.";

#[derive(Deserialize, Serialize)]
pub(crate) struct Profile {
    pub(crate) base_url: String,
    pub(crate) model: String,
}

type Profiles = BTreeMap<String, Profile>;
type Credentials = BTreeMap<String, BTreeMap<String, String>>;

/// Credentials are stored outside the app bundle and isolated by profile and API URL.
pub(crate) fn key_for(path: &Path, name: &str, url: &str) -> Result<Option<String>, String> {
    let keys: Credentials = read_json(path)?;
    Ok(keys.get(name).and_then(|endpoints| endpoints.get(url)).cloned())
}

pub(crate) fn key_locations(path: &Path) -> Result<BTreeMap<String, Vec<String>>, String> {
    let keys: Credentials = read_json(path)?;
    Ok(keys.into_iter().map(|(name, endpoints)| (name, endpoints.into_keys().collect())).collect())
}

pub(crate) fn save_key(path: &Path, name: &str, url: &str, key: &str) -> Result<(), String> {
    edit_json(path, |keys: &mut Credentials| {
        keys.entry(name.into()).or_default().insert(url.into(), key.into());
        Ok(())
    })
}

pub(crate) fn validate_endpoint(url: &str, model: &str) -> Result<(String, String), String> {
    let model = model.trim();
    if model.is_empty() || model.chars().count() > 200 {
        return Err("Enter a model name.".into());
    }
    let url = url.trim();
    let parsed =
        http_url(url).filter(|parsed| parsed.query().is_none() && parsed.fragment().is_none());
    if parsed.is_none() || url.chars().count() > 2048 {
        return Err("Enter an HTTP or HTTPS API base URL without credentials, a query, or a fragment.".into());
    }
    let url = url.trim_end_matches('/');
    let url = url.strip_suffix("/chat/completions").unwrap_or(url);
    Ok((url.trim_end_matches('/').into(), model.into()))
}

pub(crate) fn validate_api_key(base_url: &str, key: &str) -> Result<String, String> {
    let key = key.trim();
    if key.is_empty() {
        let loopback = http_url(base_url).is_some_and(|url| {
            let host = url.host_str().unwrap_or_default();
            matches!(host, "localhost" | "localhost.")
                || host
                    .trim_matches(['[', ']'])
                    .parse::<IpAddr>()
                    .is_ok_and(|ip| ip.is_loopback())
        });
        if !loopback {
            return Err("Enter an API key.".into());
        }
    } else if !key.is_ascii()
        || key
            .bytes()
            .any(|byte| byte.is_ascii_whitespace() || byte.is_ascii_control())
    {
        return Err("Enter a valid API key.".into());
    }
    Ok(key.into())
}

pub(crate) fn validate(
    name: &str,
    url: &str,
    model: &str,
) -> Result<(String, String, String), String> {
    let name = name.trim();
    if name.is_empty() || name.chars().count() > 80 {
        return Err("Enter a service name of up to 80 characters.".into());
    }
    let (url, model) = validate_endpoint(url, model)?;
    Ok((name.into(), url, model))
}

pub(crate) fn load(path: &Path) -> Result<Profiles, String> {
    read_json(path)
}

fn read_json<T: serde::de::DeserializeOwned + Default>(path: &Path) -> Result<T, String> {
    match File::open(path) {
        Ok(file) => {
            serde_json::from_reader(io::BufReader::new(file)).map_err(|_| READ_ERROR.into())
        }
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(T::default()),
        Err(_) => Err("Could not read the service configuration.".into()),
    }
}

pub(crate) fn save(path: &Path, name: &str, url: &str, model: &str) -> Result<String, String> {
    let (name, base_url, model) = validate(name, url, model)?;
    edit_json(path, |profiles: &mut Profiles| {
        profiles.insert(name.clone(), Profile { base_url, model });
        Ok(())
    })?;
    Ok(name)
}

pub(crate) fn delete(path: &Path, name: &str) -> Result<(), String> {
    edit_json(path, |profiles: &mut Profiles| {
        profiles.remove(name).ok_or(MISSING_PROFILE)?;
        Ok(())
    })
}

fn edit_json<T: Serialize + serde::de::DeserializeOwned + Default>(
    path: &Path,
    edit: impl FnOnce(&mut T) -> Result<(), &str>,
) -> Result<(), String> {
    let parent = path
        .parent()
        .filter(|path| !path.as_os_str().is_empty())
        .unwrap_or(Path::new("."));
    fs::create_dir_all(parent).map_err(|_| WRITE_ERROR)?;
    // Keep a stable lock inode while the JSON file itself is replaced atomically.
    let lock_path = path.with_extension("lock");
    let lock = OpenOptions::new()
        .create(true)
        .truncate(false)
        .write(true)
        .open(lock_path)
        .map_err(|_| WRITE_ERROR)?;
    lock.lock().map_err(|_| WRITE_ERROR)?;
    let mut values = read_json(path)?;
    edit(&mut values)?;
    let mut output = NamedTempFile::new_in(parent).map_err(|_| WRITE_ERROR)?;
    serde_json::to_writer_pretty(&mut output, &values).map_err(|_| WRITE_ERROR)?;
    output.write_all(b"\n").map_err(|_| WRITE_ERROR)?;
    output.as_file().sync_all().map_err(|_| WRITE_ERROR)?;
    output.persist(path).map_err(|_| WRITE_ERROR)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::validate_api_key;

    #[test]
    fn permits_missing_key_for_loopback_only() {
        for url in [
            "http://localhost:1234/v1",
            "http://127.0.0.1:11434/v1",
            "http://[::1]/v1",
        ] {
            assert_eq!(validate_api_key(url, " ").as_deref(), Ok(""));
        }
        for url in ["https://example.com/v1", "http://192.168.1.10/v1"] {
            assert!(validate_api_key(url, "").is_err());
            assert!(validate_api_key(url, "invalid key").is_err());
            assert_eq!(
                validate_api_key(url, " valid-key ").as_deref(),
                Ok("valid-key")
            );
        }
    }
}
