class GitSwitchboard < Formula
  desc "Interactive TUI for browsing and checking out git branches"
  homepage "https://github.com/git-switchboard/git-switchboard"
  version "{{VERSION}}"
  license "MIT"

  on_macos do
    if Hardware::CPU.arm?
      url "https://github.com/git-switchboard/git-switchboard/releases/download/git-switchboard%40{{VERSION}}/git-switchboard-darwin-arm64"
      sha256 "{{SHA256_DARWIN_ARM64}}"
    else
      url "https://github.com/git-switchboard/git-switchboard/releases/download/git-switchboard%40{{VERSION}}/git-switchboard-darwin-x64"
      sha256 "{{SHA256_DARWIN_X64}}"
    end
  end

  on_linux do
    if Hardware::CPU.arm?
      url "https://github.com/git-switchboard/git-switchboard/releases/download/git-switchboard%40{{VERSION}}/git-switchboard-linux-arm64"
      sha256 "{{SHA256_LINUX_ARM64}}"
    else
      url "https://github.com/git-switchboard/git-switchboard/releases/download/git-switchboard%40{{VERSION}}/git-switchboard-linux-x64"
      sha256 "{{SHA256_LINUX_X64}}"
    end
  end

  def install
    binary = Dir["git-switchboard*"].first
    bin.install binary => "git-switchboard"
  end

  test do
    assert_match "git-switchboard", shell_output("#{bin}/git-switchboard --help")
  end
end
