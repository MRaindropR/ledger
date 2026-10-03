import Foundation
import Vision
import ImageIO

// Read the actual simulator framebuffer; no app test-only success flag is involved.
let imageURL = URL(fileURLWithPath: CommandLine.arguments[1])
let request = VNRecognizeTextRequest()
request.recognitionLevel = .accurate
request.recognitionLanguages = ["zh-Hans", "en-US"]
request.usesLanguageCorrection = false
try VNImageRequestHandler(url: imageURL, options: [:]).perform([request])
let text = (request.results ?? []).compactMap { $0.topCandidates(1).first?.string }.joined(separator: "\n")
print(text)
let compact = text.replacingOccurrences(of: " ", with: "")
for amount in ["5.00", "85.00", "80.00", "20.00", "15.00"] {
  let pattern = "(?<![0-9])" + NSRegularExpression.escapedPattern(for: amount) + "(?![0-9])"
  guard compact.range(of: pattern, options: .regularExpression) != nil else {
    fputs("Expected native dashboard amount not visible: \(amount)\n", stderr)
    exit(1)
  }
}
print("NATIVE_SCREEN_VERIFIED: net 5.00, assets 85.00, liabilities 80.00, income 20.00, expense 15.00")
