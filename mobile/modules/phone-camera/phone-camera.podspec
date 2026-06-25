Pod::Spec.new do |s|
  s.name         = "phone-camera"
  s.version      = "1.0.0"
  s.summary      = "On-device plate recognition for Amber's Angels"
  s.homepage     = "https://amberangels.org"
  s.license      = "MIT"
  s.author       = "Amber's Angels Inc."
  s.source       = { :git => "https://github.com/grantl12/ambers-angels.git", :tag => s.version }
  s.platform     = :ios, "15.0"
  s.source_files = "ios/**/*.{swift,m}"
  s.dependency "React-Core"
end
