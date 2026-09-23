# Cask for the gitmenu Homebrew tap. Copy it to the tap repository's Casks/ folder after a
# release, setting version and sha256 (`shasum -a 256 gitmenu_<version>_aarch64.dmg`).
cask "gitmenu" do
  version "0.1.5"
  sha256 "REPLACE_WITH_DMG_SHA256"

  url "https://github.com/semanticist21/gitmenu/releases/download/v#{version}/gitmenu_#{version}_aarch64.dmg"
  name "gitmenu"
  desc "Menu bar git panel inspired by VS Code Source Control and GitLens"
  homepage "https://kkom.net/products/gitmenu"

  # The app updates itself; brew only installs it
  auto_updates true
  depends_on arch: :arm64
  depends_on macos: :ventura

  app "gitmenu.app"

  # An upgrade first moves the installed app aside, so one deleted or moved by hand stops it with
  # "It seems the App source '/Applications/gitmenu.app' is not there". Nothing in this cask runs
  # before that except loading it, so say how to recover here.
  if !Cask.generating_hash? && cask.caskroom_path.directory? && !Pathname("#{appdir}/gitmenu.app").exist?
    opoo "Homebrew lists gitmenu as installed, but #{appdir}/gitmenu.app is missing. If the " \
         "upgrade fails, run `brew uninstall --cask --force gitmenu`, then install it again."
  end

  zap trash: [
    "~/Library/Application Support/gitmenu",
    "~/Library/Caches/net.kkom.gitmenu",
    "~/Library/WebKit/net.kkom.gitmenu",
  ]
end
