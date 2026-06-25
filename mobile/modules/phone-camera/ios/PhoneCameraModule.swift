import Foundation
import UIKit
import Vision
import React

@objc(PhoneCamera)
class PhoneCameraModule: NSObject {

  // US plate heuristic: 4-8 alphanumeric, at least one letter + one digit
  private static let platePattern = try! NSRegularExpression(
    pattern: "^[A-Z0-9]{4,8}$", options: []
  )
  private static let commonWords: Set<String> = [
    "STOP", "SLOW", "EXIT", "LANE", "ONLY", "TURN", "KEEP", "RIGHT", "LEFT",
    "FORD", "JEEP", "HONDA", "TOYOTA", "CHEVY", "DODGE", "NULL", "NONE",
  ]

  private static func isPlateCandidate(_ raw: String) -> Bool {
    let s = raw.trimmingCharacters(in: .whitespaces)
      .uppercased()
      .components(separatedBy: CharacterSet.alphanumerics.inverted)
      .joined()

    guard s.count >= 4, s.count <= 8 else { return false }
    if s.allSatisfy({ $0.isNumber }) { return false }
    if s.allSatisfy({ $0.isLetter }) && s.count > 4 { return false }
    if commonWords.contains(s) { return false }

    let range = NSRange(s.startIndex..., in: s)
    return platePattern.firstMatch(in: s, options: [], range: range) != nil
  }

  @objc
  func recognizePlate(
    _ imageUri: String,
    resolver resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    guard let url = URL(string: imageUri),
          let data = try? Data(contentsOf: url),
          let image = UIImage(data: data),
          let cgImage = image.cgImage else {
      resolve([])
      return
    }

    let request = VNRecognizeTextRequest { request, error in
      guard error == nil,
            let observations = request.results as? [VNRecognizedTextObservation] else {
        resolve([])
        return
      }

      var candidates: [[String: Any]] = []
      for obs in observations {
        guard let top = obs.topCandidates(1).first else { continue }
        let raw = top.string
          .trimmingCharacters(in: .whitespaces)
          .uppercased()
          .components(separatedBy: CharacterSet.alphanumerics.inverted)
          .joined()

        guard top.confidence >= 0.55, PhoneCameraModule.isPlateCandidate(raw) else {
          continue
        }
        candidates.append([
          "plate": raw,
          "confidence": Double(top.confidence),
        ])
      }

      candidates.sort { ($0["confidence"] as? Double ?? 0) > ($1["confidence"] as? Double ?? 0) }
      resolve(candidates)
    }

    request.recognitionLevel = .fast
    request.usesLanguageCorrection = false

    DispatchQueue.global(qos: .userInitiated).async {
      let handler = VNImageRequestHandler(cgImage: cgImage, options: [:])
      do {
        try handler.perform([request])
      } catch {
        resolve([])
      }
    }
  }

  @objc static func requiresMainQueueSetup() -> Bool { false }
}
