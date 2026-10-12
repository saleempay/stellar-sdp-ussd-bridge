/**
 * Create a wallet-address disbursement in an SDP tenant and upload its
 * instructions file. On a tenant with more than one distribution account
 * the SDP requires X-Wallet-Id on writes (docs/multi-wallet/api-reference.md
 * at 7.0.0), so the default account is selected unless one is named.
 */
import type { Disbursement, SdpTenantClient } from './client.js';
import { CONTACT_TYPE_PHONE_AND_WALLET_ADDRESS, TESTNET_USDC_ISSUER, USDC_CODE } from './facts.js';

export interface UploadDisbursementParams {
  name: string;
  csv: string;
  filename: string;
  /** Distribution account to charge. Default: the tenant's default account. */
  walletId?: string;
  usdcIssuer?: string;
}

export interface UploadDisbursementResult {
  disbursement: Disbursement;
  walletId: string | undefined;
  statusAfterUpload: string;
  receiverCount: number;
  receiverWalletStatuses: string[];
}

export async function selectDistributionWalletId(client: SdpTenantClient, requested?: string): Promise<string | undefined> {
  if (requested) return requested;
  const accounts = await client.listDistributionWallets();
  if (accounts.length <= 1) return accounts[0]?.id;
  const def = accounts.find((a) => a.is_default) ?? accounts[0];
  return def?.id;
}

export async function uploadDisbursementFile(client: SdpTenantClient, p: UploadDisbursementParams): Promise<UploadDisbursementResult> {
  const issuer = p.usdcIssuer ?? TESTNET_USDC_ISSUER;
  const usdc = (await client.listAssets()).find((a) => a.code === USDC_CODE && a.issuer === issuer);
  if (!usdc) throw new Error(`tenant ${client.tenantName} has no USDC asset with the expected issuer`);
  const walletId = await selectDistributionWalletId(client, p.walletId);
  const disbursement = await client.createDisbursement(
    { name: p.name, asset_id: usdc.id, registration_contact_type: CONTACT_TYPE_PHONE_AND_WALLET_ADDRESS },
    walletId,
  );
  await client.uploadInstructions(disbursement.id, p.csv, p.filename, walletId);
  const after = await client.getDisbursement(disbursement.id, walletId);
  const receivers = await client.listDisbursementReceivers(disbursement.id, walletId);
  const statuses = receivers.data.map((r) => String((r as { receiver_wallet?: { status?: string } }).receiver_wallet?.status ?? ''));
  return { disbursement: after, walletId, statusAfterUpload: after.status, receiverCount: receivers.data.length, receiverWalletStatuses: statuses };
}
