use base64::{engine::general_purpose::STANDARD_NO_PAD, Engine as _};


pub fn decrypt(encrypted_text: &str) -> Result<String, String> {
    let encrypted_text = encrypted_text.replace("=", "");
    let data = STANDARD_NO_PAD.decode(encrypted_text);
    if data.is_err() {
        return Err("Invalid base64".to_string());
    }
    let data = data.unwrap();
    let to_string_rs = String::from_utf8(data);
    if to_string_rs.is_err() {
        return Err("Invalid UTF-8".to_string());
    }
    Ok(to_string_rs.unwrap())
}
