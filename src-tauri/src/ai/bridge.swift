// C entry points over Apple's on-device Foundation Models, called from Rust (src/ai/mod.rs).
// Built as a static library by build.rs for macOS 13; the framework is weak-linked and every
// call checks availability at run time, so the app still runs where it doesn't exist.

import Foundation
#if canImport(FoundationModels)
import FoundationModels
#endif

// Availability codes shared with Rust
private let available: Int32 = 0
private let deviceNotEligible: Int32 = 1
private let intelligenceOff: Int32 = 2
private let modelNotReady: Int32 = 3
private let unsupportedOS: Int32 = 4
private let unknown: Int32 = 5

// Error codes shared with Rust
private let errContextWindow: Int32 = 10
private let errGuardrail: Int32 = 11
private let errOther: Int32 = 12

@_cdecl("gitmenu_fm_availability")
public func gitmenuAvailability() -> Int32 {
    #if canImport(FoundationModels)
    if #available(macOS 26.0, *) {
        switch SystemLanguageModel.default.availability {
        case .available:
            return available
        case .unavailable(.deviceNotEligible):
            return deviceNotEligible
        case .unavailable(.appleIntelligenceNotEnabled):
            return intelligenceOff
        case .unavailable(.modelNotReady):
            return modelNotReady
        case .unavailable:
            return unknown
        }
    }
    #endif
    return unsupportedOS
}

/// Tokens in `text`, or -1 where counting isn't available (before macOS 26.4).
@_cdecl("gitmenu_fm_token_count")
public func gitmenuTokenCount(_ text: UnsafePointer<CChar>) -> Int64 {
    #if canImport(FoundationModels)
    if #available(macOS 26.4, *) {
        let input = String(cString: text)
        let result = blocking { () async throws -> Int in
            try await SystemLanguageModel.default.tokenCount(for: input)
        }
        if case .success(let count) = result { return Int64(count) }
    }
    #endif
    return -1
}

/// The model's context window in tokens, or -1 when unknown.
@_cdecl("gitmenu_fm_context_size")
public func gitmenuContextSize() -> Int64 {
    #if canImport(FoundationModels)
    if #available(macOS 26.4, *) {
        return Int64(SystemLanguageModel.default.contextSize)
    }
    #endif
    return -1
}

/// Generates a response. Returns a malloc'd UTF-8 string (free with gitmenu_fm_free), or nil
/// with `outError` set.
@_cdecl("gitmenu_fm_generate")
public func gitmenuGenerate(
    _ instructions: UnsafePointer<CChar>,
    _ prompt: UnsafePointer<CChar>,
    _ outError: UnsafeMutablePointer<Int32>
) -> UnsafeMutablePointer<CChar>? {
    outError.pointee = 0
    #if canImport(FoundationModels)
    if #available(macOS 26.0, *) {
        let instructionText = String(cString: instructions)
        let promptText = String(cString: prompt)
        let result = blocking { () async throws -> String in
            let session = LanguageModelSession(instructions: instructionText)
            let response = try await session.respond(
                to: promptText,
                options: GenerationOptions(temperature: 0.2)
            )
            return response.content
        }
        switch result {
        case .success(let text):
            return strdup(text)
        case .failure(let error):
            if let generationError = error as? LanguageModelSession.GenerationError {
                switch generationError {
                case .exceededContextWindowSize:
                    outError.pointee = errContextWindow
                case .guardrailViolation:
                    outError.pointee = errGuardrail
                default:
                    outError.pointee = errOther
                }
            } else {
                outError.pointee = errOther
            }
            return nil
        }
    }
    #endif
    outError.pointee = errOther
    return nil
}

@_cdecl("gitmenu_fm_free")
public func gitmenuFree(_ pointer: UnsafeMutablePointer<CChar>?) {
    free(pointer)
}

/// Runs async work to completion on a background task and waits for it. Callers are on a
/// Rust worker thread (never the main thread).
private final class Box<T>: @unchecked Sendable {
    var value: Result<T, Error>?
}

private func blocking<T>(_ work: @escaping @Sendable () async throws -> T) -> Result<T, Error> {
    let box = Box<T>()
    let semaphore = DispatchSemaphore(value: 0)
    Task.detached {
        do {
            box.value = .success(try await work())
        } catch {
            box.value = .failure(error)
        }
        semaphore.signal()
    }
    semaphore.wait()
    return box.value!
}
