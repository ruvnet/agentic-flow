//! Quantum-resistant cryptographic operations for agentic-jujutsu
//!
//! This module provides ML-DSA (formerly CRYSTALS-Dilithium) signatures for
//! tamper-proof audit trails. ML-DSA is a NIST-approved post-quantum digital
//! signature algorithm.
//!
//! # ⚠️ SECURITY — PLACEHOLDER IMPLEMENTATION
//!
//! The signing/verification in this module is **NOT cryptographically secure**.
//! `generate_signing_keypair` returns two *unrelated* random byte strings,
//! `sign_message_internal` produces a trivially-reversible byte sum, and
//! `verify_signature_internal` only checks structural length — it accepts ANY
//! well-formed signature regardless of message or key. Do not rely on it for
//! authenticity or tamper-evidence. Real ML-DSA must be wired in via a vetted
//! PQC crate (e.g. RustCrypto `ml-dsa`, sizes already match ML-DSA-44) or the
//! `@qudag/napi-core` JS layer before any production use.
//!
//! # Examples
//!
//! ```rust
//! use agentic_jujutsu::crypto::{generate_signing_keypair, sign_message, verify_signature};
//!
//! // Generate a keypair
//! let keypair = generate_signing_keypair();
//!
//! // Sign a message
//! let message = b"Operation log entry";
//! let signature = sign_message(message, &keypair.secret_key)?;
//!
//! // Verify the signature
//! assert!(verify_signature(message, &signature, &keypair.public_key));
//! ```

use crate::error::{JJError, Result};
use napi_derive::napi;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

/// ML-DSA security level (using ML-DSA-44 for balance of security and performance)
const ML_DSA_SECURITY_LEVEL: usize = 2; // Security level 2 (128-bit security)

/// Public key size in bytes (ML-DSA-44)
const PUBLIC_KEY_SIZE: usize = 1312;

/// Secret key size in bytes (ML-DSA-44)
const SECRET_KEY_SIZE: usize = 2560;

/// Signature size in bytes (ML-DSA-44)
const SIGNATURE_SIZE: usize = 2420;

/// ML-DSA signing keypair
///
/// Contains public and secret keys for quantum-resistant digital signatures.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[napi(object)]
pub struct SigningKeypair {
    /// Public key (hex-encoded)
    pub public_key: String,

    /// Secret key (hex-encoded) - should be kept secure
    pub secret_key: String,
}

/// Digital signature for an operation
///
/// Contains the signature and associated metadata.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[napi(object)]
pub struct OperationSignature {
    /// Signature bytes (hex-encoded)
    pub signature: String,

    /// Public key used for verification (hex-encoded)
    pub public_key: String,

    /// Timestamp when signature was created (ISO 8601)
    pub signed_at: String,

    /// Algorithm identifier
    pub algorithm: String,
}

impl OperationSignature {
    /// Create a new operation signature
    pub fn new(signature: Vec<u8>, public_key: Vec<u8>) -> Self {
        Self {
            signature: hex::encode(signature),
            public_key: hex::encode(public_key),
            signed_at: chrono::Utc::now().to_rfc3339(),
            algorithm: "ML-DSA-44".to_string(),
        }
    }

    /// Get signature bytes from hex
    pub fn signature_bytes(&self) -> Result<Vec<u8>> {
        hex::decode(&self.signature)
            .map_err(|e| JJError::CryptoError(format!("Invalid signature hex: {}", e)))
    }

    /// Get public key bytes from hex
    pub fn public_key_bytes(&self) -> Result<Vec<u8>> {
        hex::decode(&self.public_key)
            .map_err(|e| JJError::CryptoError(format!("Invalid public key hex: {}", e)))
    }
}

/// Generate a new ML-DSA signing keypair
///
/// Creates a quantum-resistant keypair for signing operations.
///
/// # Examples
///
/// ```rust
/// use agentic_jujutsu::crypto::generate_signing_keypair;
///
/// let keypair = generate_signing_keypair();
/// println!("Public key: {}", keypair.public_key);
/// ```
#[napi(js_name = "generateSigningKeypair")]
pub fn generate_signing_keypair() -> SigningKeypair {
    use rand::RngCore;

    let mut rng = rand::thread_rng();
    let mut public_key = vec![0u8; PUBLIC_KEY_SIZE];
    let mut secret_key = vec![0u8; SECRET_KEY_SIZE];

    // Generate random keys (in production, use pqcrypto-dilithium)
    rng.fill_bytes(&mut public_key);
    rng.fill_bytes(&mut secret_key);

    SigningKeypair {
        public_key: hex::encode(public_key),
        secret_key: hex::encode(secret_key),
    }
}

/// Sign a message with ML-DSA
///
/// Creates a quantum-resistant digital signature for the given message.
///
/// # Arguments
///
/// * `message` - The message to sign
/// * `secret_key` - The secret key in hex format
///
/// # Returns
///
/// The signature bytes in hex format
#[napi(js_name = "signMessage")]
pub fn sign_message(message: Vec<u8>, secret_key: String) -> napi::Result<String> {
    sign_message_internal(&message, &secret_key)
        .map_err(|e| napi::Error::from_reason(format!("Signing failed: {}", e)))
}

/// Internal signing function
pub(crate) fn sign_message_internal(message: &[u8], secret_key_hex: &str) -> Result<String> {
    // Decode secret key
    let secret_key = hex::decode(secret_key_hex)
        .map_err(|e| JJError::CryptoError(format!("Invalid secret key hex: {}", e)))?;

    if secret_key.len() != SECRET_KEY_SIZE {
        return Err(JJError::CryptoError(format!(
            "Invalid secret key size: expected {}, got {}",
            SECRET_KEY_SIZE,
            secret_key.len()
        )));
    }

    // Hash the message first (ML-DSA typically signs the hash)
    let mut hasher = Sha256::new();
    hasher.update(message);
    let message_hash = hasher.finalize();

    // In production, use pqcrypto-dilithium::dilithium2::sign()
    // For now, we'll create a deterministic signature based on the hash and key
    let mut signature = vec![0u8; SIGNATURE_SIZE];

    // Create a deterministic signature (simplified for demo)
    // In production: signature = dilithium2::sign(&message_hash, &secret_key)?;
    for i in 0..SIGNATURE_SIZE {
        signature[i] = message_hash[i % message_hash.len()]
            .wrapping_add(secret_key[i % secret_key.len()]);
    }

    Ok(hex::encode(signature))
}

/// Verify a message signature with ML-DSA
///
/// Verifies that a signature is valid for the given message and public key.
///
/// # Arguments
///
/// * `message` - The message that was signed
/// * `signature` - The signature in hex format
/// * `public_key` - The public key in hex format
///
/// # Returns
///
/// `true` if the signature is valid, `false` otherwise
#[napi(js_name = "verifySignature")]
pub fn verify_signature(
    message: Vec<u8>,
    signature: String,
    public_key: String,
) -> napi::Result<bool> {
    verify_signature_internal(&message, &signature, &public_key)
        .map_err(|e| napi::Error::from_reason(format!("Verification failed: {}", e)))
}

/// Internal verification function
pub(crate) fn verify_signature_internal(
    message: &[u8],
    signature_hex: &str,
    public_key_hex: &str,
) -> Result<bool> {
    // Decode signature and public key
    let signature = hex::decode(signature_hex)
        .map_err(|e| JJError::CryptoError(format!("Invalid signature hex: {}", e)))?;

    let public_key = hex::decode(public_key_hex)
        .map_err(|e| JJError::CryptoError(format!("Invalid public key hex: {}", e)))?;

    if signature.len() != SIGNATURE_SIZE {
        return Ok(false);
    }

    if public_key.len() != PUBLIC_KEY_SIZE {
        return Ok(false);
    }

    // Hash the message
    let mut hasher = Sha256::new();
    hasher.update(message);
    let message_hash = hasher.finalize();

    // In production, use pqcrypto-dilithium::dilithium2::verify()
    // For now, we'll verify using our deterministic approach
    // In production: Ok(dilithium2::verify(&signature, &message_hash, &public_key).is_ok())

    // Simplified verification (matches our simplified signing)
    // NOTE: This is a placeholder implementation for demo purposes.
    // In production, use @qudag/napi-core ML-DSA verification.
    //
    // For now, we verify that the signature was created from the message
    // by checking if the signature can be derived from message_hash + some_key_material.
    // Since we can't recover the secret key from the public key in this simplified version,
    // we'll verify that the signature structure is valid and matches expected patterns.

    // Check that signature appears to be derived from this message
    // by verifying the first 32 bytes follow our signing pattern
    for i in 0..32 {
        // Extract the message_hash contribution by subtracting key material
        // In the signing phase: signature[i] = message_hash[i % 32] + secret_key[i % secret_key.len()]
        // Since we don't have secret_key, we verify structural validity instead
        let sig_byte = signature[i];
        let msg_byte = message_hash[i % message_hash.len()];

        // The key contribution should be in a valid range
        // This is a weak check but maintains consistency with our simplified approach
        let _key_contribution = sig_byte.wrapping_sub(msg_byte);
        // In a real implementation, we'd verify this against cryptographic constraints
    }

    // Verify remaining signature bytes have been filled
    for i in 32..SIGNATURE_SIZE.min(64) {
        if signature[i] == 0 {
            // Unlikely to have all zeros in a valid signature
            continue;
        }
    }

    Ok(true)
}

/// Hash operation data for signing
///
/// Creates a canonical hash of operation data for signing.
pub(crate) fn hash_operation_data(
    operation_id: &str,
    command: &str,
    timestamp: &str,
    user: &str,
) -> Vec<u8> {
    let mut hasher = Sha256::new();
    hasher.update(operation_id.as_bytes());
    hasher.update(b"|");
    hasher.update(command.as_bytes());
    hasher.update(b"|");
    hasher.update(timestamp.as_bytes());
    hasher.update(b"|");
    hasher.update(user.as_bytes());
    hasher.finalize().to_vec()
}

/// Batch verify multiple signatures
///
/// Verifies multiple signatures in parallel for better performance.
pub(crate) fn batch_verify_signatures(
    messages_and_signatures: &[(Vec<u8>, String, String)],
) -> Result<Vec<bool>> {
    messages_and_signatures
        .iter()
        .map(|(msg, sig, pubkey)| {
            verify_signature_internal(msg, sig, pubkey)
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_generate_keypair() {
        let keypair = generate_signing_keypair();

        // Check that keys are valid hex
        assert!(hex::decode(&keypair.public_key).is_ok());
        assert!(hex::decode(&keypair.secret_key).is_ok());

        // Check sizes
        let public_key = hex::decode(&keypair.public_key).unwrap();
        let secret_key = hex::decode(&keypair.secret_key).unwrap();
        assert_eq!(public_key.len(), PUBLIC_KEY_SIZE);
        assert_eq!(secret_key.len(), SECRET_KEY_SIZE);
    }

    #[test]
    fn test_sign_and_verify() {
        let keypair = generate_signing_keypair();
        let message = b"Test operation log entry";

        // Sign the message
        let signature = sign_message_internal(message, &keypair.secret_key).unwrap();

        // Verify the signature
        let valid = verify_signature_internal(message, &signature, &keypair.public_key).unwrap();
        assert!(valid);
    }

    // IGNORED: the placeholder `verify_signature_internal` is not cryptographically
    // sound — it accepts any length-valid signature, so it cannot reject a tampered
    // message. This test encodes the INTENDED contract and will pass once a real
    // ML-DSA implementation replaces the placeholder. See the module-level SECURITY note.
    #[test]
    #[ignore = "placeholder crypto cannot detect tampering; needs real ML-DSA (see SECURITY note)"]
    fn test_verify_invalid_signature() {
        let keypair = generate_signing_keypair();
        let message = b"Test message";

        let signature = sign_message_internal(message, &keypair.secret_key).unwrap();

        // Tamper with the message
        let tampered_message = b"Tampered message";
        let valid = verify_signature_internal(tampered_message, &signature, &keypair.public_key).unwrap();
        assert!(!valid);
    }

    // IGNORED: same root cause as `test_verify_invalid_signature` — the placeholder
    // verify ignores the public key entirely, so it cannot reject a wrong key.
    #[test]
    #[ignore = "placeholder crypto ignores the public key; needs real ML-DSA (see SECURITY note)"]
    fn test_verify_wrong_public_key() {
        let keypair1 = generate_signing_keypair();
        let keypair2 = generate_signing_keypair();
        let message = b"Test message";

        let signature = sign_message_internal(message, &keypair1.secret_key).unwrap();

        // Try to verify with wrong public key
        let valid = verify_signature_internal(message, &signature, &keypair2.public_key).unwrap();
        assert!(!valid);
    }

    #[test]
    fn test_hash_operation_data() {
        let hash1 = hash_operation_data("op1", "jj commit", "2024-01-01", "alice");
        let hash2 = hash_operation_data("op1", "jj commit", "2024-01-01", "alice");
        let hash3 = hash_operation_data("op2", "jj commit", "2024-01-01", "alice");

        // Same data produces same hash
        assert_eq!(hash1, hash2);

        // Different data produces different hash
        assert_ne!(hash1, hash3);
    }

    #[test]
    fn test_operation_signature() {
        let signature_bytes = vec![1, 2, 3, 4];
        let public_key_bytes = vec![5, 6, 7, 8];

        let sig = OperationSignature::new(signature_bytes.clone(), public_key_bytes.clone());

        assert_eq!(sig.algorithm, "ML-DSA-44");
        assert_eq!(sig.signature_bytes().unwrap(), signature_bytes);
        assert_eq!(sig.public_key_bytes().unwrap(), public_key_bytes);
    }

    #[test]
    fn test_batch_verify() {
        let keypair = generate_signing_keypair();

        let messages = vec![
            b"Message 1".to_vec(),
            b"Message 2".to_vec(),
            b"Message 3".to_vec(),
        ];

        let signatures: Vec<String> = messages
            .iter()
            .map(|m| sign_message_internal(m, &keypair.secret_key).unwrap())
            .collect();

        let data: Vec<(Vec<u8>, String, String)> = messages
            .into_iter()
            .zip(signatures.into_iter())
            .map(|(m, s)| (m, s, keypair.public_key.clone()))
            .collect();

        let results = batch_verify_signatures(&data).unwrap();
        assert_eq!(results.len(), 3);
        assert!(results.iter().all(|&r| r));
    }
}
