import { randomBytes } from "crypto";
import type {
  OAuthClientInformationMixed,
  OAuthClientMetadata,
  OAuthTokens,
} from "@modelcontextprotocol/sdk/shared/auth.js";
import type {
  OAuthClientProvider,
  OAuthDiscoveryState,
} from "@modelcontextprotocol/sdk/client/auth.js";
import * as vscode from "vscode";

const SECRET_TOKENS = "agentPanel.figma.oauth.tokens";
const SECRET_CLIENT = "agentPanel.figma.oauth.client";
const SECRET_VERIFIER = "agentPanel.figma.oauth.verifier";
const SECRET_DISCOVERY = "agentPanel.figma.oauth.discovery";
const SECRET_STATE = "agentPanel.figma.oauth.state";

async function readJsonSecret<T>(
  secrets: vscode.SecretStorage,
  key: string
): Promise<T | undefined> {
  const raw = await secrets.get(key);
  if (!raw) {
    return undefined;
  }
  try {
    return JSON.parse(raw) as T;
  } catch {
    return undefined;
  }
}

async function writeJsonSecret(
  secrets: vscode.SecretStorage,
  key: string,
  value: unknown
): Promise<void> {
  await secrets.store(key, JSON.stringify(value));
}

export class VsCodeFigmaOAuthProvider implements OAuthClientProvider {
  private _codeVerifier?: string;
  private _tokens?: OAuthTokens;
  private _clientInformation?: OAuthClientInformationMixed;
  private _discovery?: OAuthDiscoveryState;
  private _state?: string;
  private loaded = false;

  constructor(
    private readonly secrets: vscode.SecretStorage,
    private readonly _redirectUrl: string,
    private readonly onRedirect: (url: URL) => void | Promise<void>
  ) {}

  get redirectUrl(): string {
    return this._redirectUrl;
  }

  get clientMetadata(): OAuthClientMetadata {
    return {
      client_name: "Harbor Agents",
      redirect_uris: [this._redirectUrl],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    };
  }

  async ensureLoaded(): Promise<void> {
    if (this.loaded) {
      return;
    }
    this._tokens = await readJsonSecret<OAuthTokens>(
      this.secrets,
      SECRET_TOKENS
    );
    this._clientInformation = await readJsonSecret<OAuthClientInformationMixed>(
      this.secrets,
      SECRET_CLIENT
    );
    this._discovery = await readJsonSecret<OAuthDiscoveryState>(
      this.secrets,
      SECRET_DISCOVERY
    );
    this._codeVerifier = await this.secrets.get(SECRET_VERIFIER);
    this._state = await this.secrets.get(SECRET_STATE);
    this.loaded = true;
  }

  state(): string {
    if (!this._state) {
      this._state = randomBytes(16).toString("hex");
      void this.secrets.store(SECRET_STATE, this._state);
    }
    return this._state;
  }

  async clientInformation(): Promise<OAuthClientInformationMixed | undefined> {
    await this.ensureLoaded();
    return this._clientInformation;
  }

  async saveClientInformation(
    clientInformation: OAuthClientInformationMixed
  ): Promise<void> {
    this._clientInformation = clientInformation;
    await writeJsonSecret(this.secrets, SECRET_CLIENT, clientInformation);
  }

  async tokens(): Promise<OAuthTokens | undefined> {
    await this.ensureLoaded();
    return this._tokens;
  }

  async saveTokens(tokens: OAuthTokens): Promise<void> {
    this._tokens = tokens;
    await writeJsonSecret(this.secrets, SECRET_TOKENS, tokens);
  }

  async redirectToAuthorization(authorizationUrl: URL): Promise<void> {
    await this.onRedirect(authorizationUrl);
  }

  async saveCodeVerifier(codeVerifier: string): Promise<void> {
    this._codeVerifier = codeVerifier;
    await this.secrets.store(SECRET_VERIFIER, codeVerifier);
  }

  async codeVerifier(): Promise<string> {
    await this.ensureLoaded();
    if (!this._codeVerifier) {
      throw new Error("No OAuth code verifier saved");
    }
    return this._codeVerifier;
  }

  async saveDiscoveryState(state: OAuthDiscoveryState): Promise<void> {
    this._discovery = state;
    await writeJsonSecret(this.secrets, SECRET_DISCOVERY, state);
  }

  async discoveryState(): Promise<OAuthDiscoveryState | undefined> {
    await this.ensureLoaded();
    return this._discovery;
  }

  async invalidateCredentials(
    scope: "all" | "client" | "tokens" | "verifier" | "discovery"
  ): Promise<void> {
    const clear = async (key: string) => {
      try {
        await this.secrets.delete(key);
      } catch {
        // ignore
      }
    };
    if (scope === "all" || scope === "tokens") {
      this._tokens = undefined;
      await clear(SECRET_TOKENS);
    }
    if (scope === "all" || scope === "client") {
      this._clientInformation = undefined;
      await clear(SECRET_CLIENT);
    }
    if (scope === "all" || scope === "verifier") {
      this._codeVerifier = undefined;
      await clear(SECRET_VERIFIER);
      this._state = undefined;
      await clear(SECRET_STATE);
    }
    if (scope === "all" || scope === "discovery") {
      this._discovery = undefined;
      await clear(SECRET_DISCOVERY);
    }
  }

  async clearAll(): Promise<void> {
    await this.invalidateCredentials("all");
    this.loaded = true;
  }

  async hasStoredTokens(): Promise<boolean> {
    await this.ensureLoaded();
    return Boolean(this._tokens?.access_token);
  }
}
