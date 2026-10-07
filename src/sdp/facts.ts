/**
 * Upstream facts this repository pins, each with its source. Nothing here
 * is written from memory. When the pinned SDP version changes, every line
 * in this file is re-verified against the new tag before it is edited.
 *
 * Source repository: github.com/stellar/stellar-disbursement-platform-backend
 * Pinned tag: 7.0.0 (commit 14704274467d267b6c6679052d7251ef6050d118,
 * released 19 August 2026). File paths below are relative to that tag.
 */

/** SDP release this bridge is built and tested against. */
export const SDP_VERSION = '7.0.0';

/**
 * Published images and their manifest digests, read from the Docker Hub
 * tags API on 7 October 2026. Both SDP images are built for linux/amd64
 * only; on Apple Silicon they run under Rosetta or QEMU emulation.
 */
export const SDP_IMAGES = {
  backend:
    'stellar/stellar-disbursement-platform-backend:7.0.0@sha256:54dc7b94656e2d8a84e81e32e787ecbd9ca23a61fe168b60ab4f750072bac126',
  frontend:
    'stellar/stellar-disbursement-platform-frontend:7.0.0@sha256:edec92a3c3169a041364ea218ec55c905b7e869af8ecb936f0a87ca5f45ea2b7',
  postgres:
    'postgres:14-alpine@sha256:4ea9e5ed06591da7ea23eb65465e8d3187fe79f4d5ec3ae976d29a33b013e77a',
} as const;

/**
 * Testnet USDC issuer. Source: internal/services/assets/assets_testnet.go
 * (USDCAssetIssuerTestnet) at tag 7.0.0, matching the issuer shown in the
 * official path payments guide on developers.stellar.org. The SDP seeds
 * this asset for every testnet tenant in `db setup-for-network`
 * (internal/services/setup_assets_for_network_service.go).
 */
export const TESTNET_USDC_ISSUER = 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5';
export const USDC_CODE = 'USDC';

/**
 * The registration contact type for recipients identified by phone number
 * and paid straight to a known wallet address, with no SDP registration
 * step. Source: internal/data/registration_contact_type.go (String() of
 * RegistrationContactTypePhoneAndWalletAddress).
 */
export const CONTACT_TYPE_PHONE_AND_WALLET_ADDRESS = 'PHONE_NUMBER_AND_WALLET_ADDRESS';

/**
 * The wallet record wallet-address disbursements run through. For that
 * contact type the SDP rejects a `wallet_id` in the request and looks up
 * the enabled wallet with `user_managed = true` itself
 * (internal/serve/httphandler/disbursement_handler.go:66-76,142-160). It
 * seeds one on testnet under this name
 * (internal/services/wallets/wallets_testnet.go), so it must be enabled.
 */
export const USER_MANAGED_WALLET_NAME = 'User Managed Wallet';

/** Stellar testnet identifiers, as in dev/.env.example at tag 7.0.0. */
export const TESTNET_NETWORK_PASSPHRASE = 'Test SDF Network ; September 2015';
export const TESTNET_HORIZON_URL = 'https://horizon-testnet.stellar.org';

/** Tenant distribution account types. Source: pkg/schema/account_type.go. */
export const DISTRIBUTION_ACCOUNT_DB_VAULT = 'DISTRIBUTION_ACCOUNT.STELLAR.DB_VAULT';
export const DISTRIBUTION_ACCOUNT_ENV = 'DISTRIBUTION_ACCOUNT.STELLAR.ENV';

/** Header the SDP reads first when resolving the tenant (middleware.go). */
export const TENANT_HEADER = 'SDP-Tenant-Name';
/** Header naming the distribution account on multi-account tenants. */
export const WALLET_ID_HEADER = 'X-Wallet-Id';

/** Mask a Stellar account for reports: first 4 and last 4 characters. */
export function maskAccount(account: string | null | undefined): string {
  if (!account) return '(none)';
  if (account.length <= 8) return account;
  return `${account.slice(0, 4)}...${account.slice(-4)}`;
}
