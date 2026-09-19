# Cask for the gitside Homebrew tap. Copy it to the tap repository's Casks/ folder after a
# release, setting version and sha256 (`shasum -a 256 gitside_<version>_universal.dmg`).
cask "gitside" do
  version "0.1.0"
  sha256 "REPLACE_WITH_DMG_SHA256"

  url "https://github.com/semanticist21/gitside/releases/download/v#{version}/gitside_#{version}_universal.dmg"
  name "gitside"
  desc "Menu bar git panel with VS Code Source Control and GitLens features"
  homepage "https://kkom.net/gitside"

  # The app updates itself; brew only installs it
  auto_updates true
  depends_on macos: ">= :ventura"

  app "gitside.app"

  zap trash: [
    "~/Library/Application Support/gitside",
    "~/Library/Caches/net.kkom.gitside",
    "~/Library/WebKit/net.kkom.gitside",
  ]
end
