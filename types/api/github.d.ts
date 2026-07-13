import type { Endpoints } from "@octokit/types";

declare global {
  namespace $gh {
    namespace Gist {
      type Response = Endpoints["GET /gists/{gist_id}"]["response"]["data"];
    }

    namespace Gists {
      type Response = Endpoints["GET /gists"]["response"]["data"];
    }

    /**
     * Device Authorization Grant request/response bodies.
     *
     * @see https://docs.github.com/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps#device-flow
     */
    namespace Login {
      /** `POST /login/device/code` success body. */
      interface DeviceCode {
        device_code: string;
        user_code: string;
        verification_uri: string;
        expires_in: number;
        interval: number;
      }

      /** `POST /login/oauth/access_token` success body. */
      interface OAuthToken {
        access_token: string;
        token_type: string;
        scope: string;
      }

      /**
       * OAuth error body from `POST /login/device/code` and
       * `POST /login/oauth/access_token`.
       *
       * @see https://docs.github.com/en/apps/oauth-apps/maintaining-oauth-apps/troubleshooting-oauth-app-access-token-request-errors
       * @see https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps#device-flow — `interval` on `slow_down`
       */
      interface OAuthError {
        error: string;
        error_description?: string;
        error_uri?: string;
        interval?: number;
      }

      type DeviceCodeResponse = DeviceCode | OAuthError;
      type OAuthTokenResponse = OAuthToken | OAuthError;
    }
  }
}
