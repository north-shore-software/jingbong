import { createSign } from "node:crypto";
import { readFile } from "node:fs/promises";

export interface GitHubAppTokenProviderConfig {
	appId: string;
	/** Installation used by getToken() when no repository is named. */
	installationId: string;
	privateKeyPath: string;
	/** GitHub API base URL (default: https://api.github.com) */
	apiBaseUrl?: string;
}

/**
 * Mints and caches GitHub App installation tokens for self-hosted users.
 *
 * Uses the App's private key to sign a JWT, then exchanges it for a
 * short-lived installation access token via the GitHub API.
 * Tokens are cached per installation and refreshed 5 minutes before expiry.
 * The App can be installed on several accounts: getTokenForRepo() finds the
 * installation that covers a given repository.
 */
export class GitHubAppTokenProvider {
	private config: GitHubAppTokenProviderConfig;
	private tokens = new Map<string, { token: string; expiresAt: number }>();
	/** "owner/repo" (lowercase) -> installation id */
	private repoInstallations = new Map<string, string>();
	private privateKeyPromise: Promise<string> | null = null;

	constructor(config: GitHubAppTokenProviderConfig) {
		this.config = config;
	}

	/**
	 * Get a valid access token for the configured installation.
	 * Returns cached token if still valid, otherwise mints a new one.
	 */
	getToken(): Promise<string> {
		return this.getInstallationToken(this.config.installationId);
	}

	/**
	 * Get a valid access token for the installation that covers
	 * `owner/repo`, which may be on a different account than the configured one.
	 */
	async getTokenForRepo(slug: string): Promise<string> {
		const key = slug.toLowerCase();
		let installationId = this.repoInstallations.get(key);
		if (!installationId) {
			const response = await this.appRequest(`/repos/${slug}/installation`);
			const data = (await response.json()) as { id: number };
			installationId = String(data.id);
			this.repoInstallations.set(key, installationId);
		}
		return this.getInstallationToken(installationId);
	}

	private async getInstallationToken(installationId: string): Promise<string> {
		// Refresh 5 minutes before expiry
		const cached = this.tokens.get(installationId);
		if (cached && Date.now() < cached.expiresAt - 5 * 60 * 1000) {
			return cached.token;
		}

		const response = await this.appRequest(
			`/app/installations/${installationId}/access_tokens`,
			"POST",
		);
		const data = (await response.json()) as {
			token: string;
			expires_at: string;
		};

		this.tokens.set(installationId, {
			token: data.token,
			expiresAt: new Date(data.expires_at).getTime(),
		});

		return data.token;
	}

	/** A GitHub API request authenticated as the App itself (JWT). */
	private async appRequest(path: string, method = "GET"): Promise<Response> {
		const pem = await this.loadPrivateKey();
		const jwt = createAppJwt(this.config.appId, pem);
		const apiBase = this.config.apiBaseUrl ?? "https://api.github.com";

		const response = await fetch(`${apiBase}${path}`, {
			method,
			headers: {
				Authorization: `Bearer ${jwt}`,
				Accept: "application/vnd.github+json",
				"X-GitHub-Api-Version": "2022-11-28",
			},
		});

		if (!response.ok) {
			const body = await response.text();
			throw new Error(
				`[GitHubAppTokenProvider] Failed to ${path.endsWith("/access_tokens") ? "create installation token" : `look up ${path}`}: ${response.status} ${response.statusText} - ${body}`,
			);
		}
		return response;
	}

	private loadPrivateKey(): Promise<string> {
		if (!this.privateKeyPromise) {
			this.privateKeyPromise = readFile(this.config.privateKeyPath, "utf-8");
		}
		return this.privateKeyPromise;
	}
}

/**
 * Create a JWT for GitHub App authentication.
 * Uses Node's native crypto — no external JWT library needed.
 *
 * @see https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-a-json-web-token-jwt-for-a-github-app
 */
export function createAppJwt(appId: string, privateKey: string): string {
	const now = Math.floor(Date.now() / 1000);
	const header = Buffer.from(
		JSON.stringify({ alg: "RS256", typ: "JWT" }),
	).toString("base64url");
	const payload = Buffer.from(
		JSON.stringify({
			iat: now - 60,
			exp: now + 10 * 60,
			iss: appId,
		}),
	).toString("base64url");

	const sign = createSign("RSA-SHA256");
	sign.update(`${header}.${payload}`);
	const signature = sign.sign(privateKey, "base64url");

	return `${header}.${payload}.${signature}`;
}
