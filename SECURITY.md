# Security policy

## What the plugin does

The helpers run locally under your user account and make no network requests. They write only inside the project's `.requirements/` directory. They also read the local source files that a discovery records with a `sha256` snapshot, to detect changes. Handoff hashes protect freshness, not authenticity against someone who can already write to the project directory.

## Reporting a vulnerability

Please report a suspected vulnerability privately through GitHub's [private vulnerability reporting](https://docs.github.com/en/code-security/security-advisories/guidance-on-reporting-and-writing-information-about-vulnerabilities/privately-reporting-a-security-vulnerability) on this repository's **Security** tab instead of opening a public issue.
