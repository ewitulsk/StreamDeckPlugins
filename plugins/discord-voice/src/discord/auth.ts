import type { RpcClient } from "./rpc.js";

export const SCOPES = ["rpc", "rpc.voice.read", "rpc.voice.write", "identify", "guilds"];

export type Credentials = {
	clientId: string;
	clientSecret: string;
	redirectUri?: string;
};

export type StoredToken = {
	accessToken: string;
	refreshToken: string;
	/** Epoch ms. */
	expiresAt: number;
	scopes: string[];
};

export interface TokenStore {
	load(): Promise<StoredToken | undefined>;
	save(token: StoredToken | undefined): Promise<void>;
}

type TokenResponse = {
	access_token: string;
	refresh_token: string;
	expires_in: number;
	scope: string;
};

const TOKEN_URL = "https://discord.com/api/v10/oauth2/token";

async function tokenRequest(params: Record<string, string>): Promise<StoredToken> {
	const res = await fetch(TOKEN_URL, {
		method: "POST",
		headers: { "Content-Type": "application/x-www-form-urlencoded" },
		body: new URLSearchParams(params),
	});
	const text = await res.text();
	if (!res.ok) throw new Error(`Token request failed (${res.status}): ${text}`);
	const body = JSON.parse(text) as TokenResponse;
	return {
		accessToken: body.access_token,
		refreshToken: body.refresh_token,
		expiresAt: Date.now() + body.expires_in * 1000,
		scopes: body.scope.split(" "),
	};
}

export function exchangeCode(creds: Credentials, code: string): Promise<StoredToken> {
	const params: Record<string, string> = {
		grant_type: "authorization_code",
		code,
		client_id: creds.clientId,
		client_secret: creds.clientSecret,
	};
	if (creds.redirectUri) params.redirect_uri = creds.redirectUri;
	return tokenRequest(params);
}

export function refreshToken(creds: Credentials, refresh: string): Promise<StoredToken> {
	return tokenRequest({
		grant_type: "refresh_token",
		refresh_token: refresh,
		client_id: creds.clientId,
		client_secret: creds.clientSecret,
	});
}

const hasAllScopes = (token: StoredToken) => SCOPES.every((s) => token.scopes.includes(s));

/**
 * Authenticates an already-connected RPC client: reuses the stored token, refreshes it when
 * close to expiry, and falls back to the interactive AUTHORIZE popup inside Discord.
 */
export async function login(
	rpc: RpcClient,
	creds: Credentials,
	store: TokenStore,
	onPrompt?: () => void,
): Promise<void> {
	let token = await store.load();

	if (token && !hasAllScopes(token)) token = undefined;

	if (token && token.expiresAt - Date.now() < 24 * 3600_000) {
		try {
			token = await refreshToken(creds, token.refreshToken);
			await store.save(token);
		} catch {
			token = undefined;
		}
	}

	if (token) {
		try {
			await rpc.authenticate(token.accessToken);
			return;
		} catch {
			await store.save(undefined);
		}
	}

	onPrompt?.();
	const { code } = await rpc.authorize(SCOPES);
	token = await exchangeCode(creds, code);
	await store.save(token);
	await rpc.authenticate(token.accessToken);
}
