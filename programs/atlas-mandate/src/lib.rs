//! Atlas Rail on-chain mandate registry (Milestone 1).
//!
//! An agent mandate is created and enforced off-chain by the Atlas Rail policy gate
//! (see `packages/mandate` and `spec/agent-mandate-v0.1.md`). This program makes the
//! mandate's *existence and revocation* a public, tamper-evident fact on Solana:
//!
//! * `create_mandate` records the mandate hash and its hard limits. It only succeeds when
//!   the owner, an independent approver and the agent itself all sign the same
//!   transaction, mirroring the off-chain delegation chain.
//! * `revoke_mandate` lets the owner or the approver revoke it. Revocation is final.
//!
//! The policy gate reads this account before every payment and denies if the mandate is
//! missing, revoked, not yet valid or expired.
//!
//! Devnet and localnet only. Atlas Rail never deploys to mainnet.

use anchor_lang::prelude::*;

declare_id!("DuQ4Aeim1uWt8xUT8NBCNoo6HkLiwRCQRJ7GVxZY9Qf4");

/// Seed prefix for mandate accounts: `["mandate", mandate_hash]`.
pub const MANDATE_SEED: &[u8] = b"mandate";

/// Same bounds as `mandateLimitsSchema.windowSeconds` in `packages/mandate/src/schema.ts`.
pub const MIN_WINDOW_SECONDS: i64 = 60;
pub const MAX_WINDOW_SECONDS: i64 = 31_536_000;

#[program]
pub mod atlas_mandate {
    use super::*;

    /// Record a mandate on-chain. Owner, approver and agent must all sign.
    pub fn create_mandate(ctx: Context<CreateMandate>, args: CreateMandateArgs) -> Result<()> {
        let owner = ctx.accounts.owner.key();
        let approver = ctx.accounts.approver.key();
        let agent = ctx.accounts.agent.key();
        let now = Clock::get()?.unix_timestamp;

        validate_create(&args, &owner, &approver, &agent, now)?;

        let mandate = &mut ctx.accounts.mandate;
        mandate.mandate_hash = args.mandate_hash;
        mandate.owner = owner;
        mandate.approver = approver;
        mandate.agent = agent;
        mandate.gate_authority = args.gate_authority;
        mandate.mint = args.mint;
        mandate.max_per_payment = args.max_per_payment;
        mandate.max_per_window = args.max_per_window;
        mandate.window_seconds = args.window_seconds;
        mandate.max_total = args.max_total;
        mandate.escalation_threshold = args.escalation_threshold;
        mandate.not_before = args.not_before;
        mandate.expires_at = args.expires_at;
        mandate.created_at = now;
        mandate.revoked = false;
        mandate.revoked_at = 0;
        mandate.revoked_by = Pubkey::default();
        mandate.bump = ctx.bumps.mandate;

        emit!(MandateCreated {
            mandate: mandate.key(),
            mandate_hash: args.mandate_hash,
            owner,
            approver,
            agent,
            expires_at: args.expires_at,
        });
        Ok(())
    }

    /// Revoke a mandate. Only the owner or the approver may do this, and only once.
    pub fn revoke_mandate(ctx: Context<RevokeMandate>) -> Result<()> {
        let authority = ctx.accounts.authority.key();
        let now = Clock::get()?.unix_timestamp;
        let mandate = &mut ctx.accounts.mandate;

        require!(
            authority == mandate.owner || authority == mandate.approver,
            MandateError::NotAuthorizedToRevoke
        );
        require!(!mandate.revoked, MandateError::AlreadyRevoked);

        mandate.revoked = true;
        mandate.revoked_at = now;
        mandate.revoked_by = authority;

        emit!(MandateRevoked {
            mandate: mandate.key(),
            mandate_hash: mandate.mandate_hash,
            revoked_by: authority,
            revoked_at: now,
        });
        Ok(())
    }
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, PartialEq, Eq)]
pub struct CreateMandateArgs {
    /// SHA-256 of the canonical (JCS) off-chain mandate body. Also the PDA seed.
    pub mandate_hash: [u8; 32],
    /// Key the Atlas Rail instance signs gate decisions and receipts with.
    pub gate_authority: Pubkey,
    pub mint: Pubkey,
    pub max_per_payment: u64,
    pub max_per_window: u64,
    pub window_seconds: i64,
    pub max_total: u64,
    pub escalation_threshold: u64,
    pub not_before: i64,
    pub expires_at: i64,
}

#[derive(Accounts)]
#[instruction(args: CreateMandateArgs)]
pub struct CreateMandate<'info> {
    #[account(
        init,
        payer = owner,
        space = 8 + Mandate::INIT_SPACE,
        seeds = [MANDATE_SEED, args.mandate_hash.as_ref()],
        bump
    )]
    pub mandate: Account<'info, Mandate>,
    #[account(mut)]
    pub owner: Signer<'info>,
    pub approver: Signer<'info>,
    /// Proof of possession: the agent's key must sign too.
    pub agent: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct RevokeMandate<'info> {
    #[account(
        mut,
        seeds = [MANDATE_SEED, mandate.mandate_hash.as_ref()],
        bump = mandate.bump
    )]
    pub mandate: Account<'info, Mandate>,
    pub authority: Signer<'info>,
}

#[account]
#[derive(InitSpace, Debug)]
pub struct Mandate {
    pub mandate_hash: [u8; 32],
    pub owner: Pubkey,
    pub approver: Pubkey,
    pub agent: Pubkey,
    pub gate_authority: Pubkey,
    pub mint: Pubkey,
    pub max_per_payment: u64,
    pub max_per_window: u64,
    pub window_seconds: i64,
    pub max_total: u64,
    pub escalation_threshold: u64,
    pub not_before: i64,
    pub expires_at: i64,
    pub created_at: i64,
    pub revoked: bool,
    pub revoked_at: i64,
    pub revoked_by: Pubkey,
    pub bump: u8,
}

impl Mandate {
    /// What the policy gate checks before every payment.
    pub fn is_active(&self, now: i64) -> bool {
        !self.revoked && now >= self.not_before && now < self.expires_at
    }
}

#[event]
pub struct MandateCreated {
    pub mandate: Pubkey,
    pub mandate_hash: [u8; 32],
    pub owner: Pubkey,
    pub approver: Pubkey,
    pub agent: Pubkey,
    pub expires_at: i64,
}

#[event]
pub struct MandateRevoked {
    pub mandate: Pubkey,
    pub mandate_hash: [u8; 32],
    pub revoked_by: Pubkey,
    pub revoked_at: i64,
}

#[error_code]
pub enum MandateError {
    #[msg("The approver must be a different key from the owner")]
    ApproverIsOwner,
    #[msg("The agent key must differ from the owner and the approver")]
    AgentNotIndependent,
    #[msg("Limits must be greater than zero")]
    ZeroLimit,
    #[msg("max_per_payment cannot exceed max_total")]
    PerPaymentAboveTotal,
    #[msg("max_per_window cannot exceed max_total")]
    WindowAboveTotal,
    #[msg("window_seconds is out of range")]
    InvalidWindow,
    #[msg("expires_at must be after not_before")]
    InvalidValidity,
    #[msg("The mandate has already expired")]
    AlreadyExpired,
    #[msg("Only the owner or the approver can revoke this mandate")]
    NotAuthorizedToRevoke,
    #[msg("The mandate is already revoked")]
    AlreadyRevoked,
}

/// Pure validation, kept separate so it can be unit-tested without a validator.
/// Mirrors the refinements in `packages/mandate/src/schema.ts`.
pub fn validate_create(
    args: &CreateMandateArgs,
    owner: &Pubkey,
    approver: &Pubkey,
    agent: &Pubkey,
    now: i64,
) -> Result<()> {
    require!(owner != approver, MandateError::ApproverIsOwner);
    require!(agent != owner && agent != approver, MandateError::AgentNotIndependent);
    require!(
        args.max_per_payment > 0 && args.max_per_window > 0 && args.max_total > 0,
        MandateError::ZeroLimit
    );
    require!(args.max_per_payment <= args.max_total, MandateError::PerPaymentAboveTotal);
    require!(args.max_per_window <= args.max_total, MandateError::WindowAboveTotal);
    require!(
        (MIN_WINDOW_SECONDS..=MAX_WINDOW_SECONDS).contains(&args.window_seconds),
        MandateError::InvalidWindow
    );
    require!(args.expires_at > args.not_before, MandateError::InvalidValidity);
    require!(args.expires_at > now, MandateError::AlreadyExpired);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn key(byte: u8) -> Pubkey {
        Pubkey::new_from_array([byte; 32])
    }

    fn args() -> CreateMandateArgs {
        CreateMandateArgs {
            mandate_hash: [7; 32],
            gate_authority: key(9),
            mint: key(8),
            max_per_payment: 50_000_000,
            max_per_window: 100_000_000,
            window_seconds: 86_400,
            max_total: 500_000_000,
            escalation_threshold: 25_000_000,
            not_before: 1_000,
            expires_at: 10_000,
        }
    }

    fn err_of(result: Result<()>) -> anchor_lang::error::Error {
        result.expect_err("expected validation to fail")
    }

    fn assert_err(result: Result<()>, expected: MandateError) {
        assert_eq!(err_of(result), expected.into());
    }

    #[test]
    fn accepts_a_valid_mandate() {
        assert!(validate_create(&args(), &key(1), &key(2), &key(3), 2_000).is_ok());
    }

    #[test]
    fn rejects_owner_approving_their_own_mandate() {
        assert_err(validate_create(&args(), &key(1), &key(1), &key(3), 2_000), MandateError::ApproverIsOwner);
    }

    #[test]
    fn rejects_agent_reusing_a_human_key() {
        assert_err(
            validate_create(&args(), &key(1), &key(2), &key(1), 2_000),
            MandateError::AgentNotIndependent,
        );
        assert_err(
            validate_create(&args(), &key(1), &key(2), &key(2), 2_000),
            MandateError::AgentNotIndependent,
        );
    }

    #[test]
    fn rejects_zero_limits() {
        let mut a = args();
        a.max_per_payment = 0;
        assert_err(validate_create(&a, &key(1), &key(2), &key(3), 2_000), MandateError::ZeroLimit);
    }

    #[test]
    fn rejects_per_payment_above_total() {
        let mut a = args();
        a.max_per_payment = a.max_total + 1;
        assert_err(validate_create(&a, &key(1), &key(2), &key(3), 2_000), MandateError::PerPaymentAboveTotal);
    }

    #[test]
    fn rejects_window_above_total() {
        let mut a = args();
        a.max_per_window = a.max_total + 1;
        assert_err(validate_create(&a, &key(1), &key(2), &key(3), 2_000), MandateError::WindowAboveTotal);
    }

    #[test]
    fn rejects_window_out_of_range() {
        let mut a = args();
        a.window_seconds = 59;
        assert_err(validate_create(&a, &key(1), &key(2), &key(3), 2_000), MandateError::InvalidWindow);
        a.window_seconds = MAX_WINDOW_SECONDS + 1;
        assert_err(validate_create(&a, &key(1), &key(2), &key(3), 2_000), MandateError::InvalidWindow);
    }

    #[test]
    fn rejects_inverted_validity() {
        let mut a = args();
        a.expires_at = a.not_before;
        assert_err(validate_create(&a, &key(1), &key(2), &key(3), 500), MandateError::InvalidValidity);
    }

    #[test]
    fn rejects_already_expired() {
        assert_err(
            validate_create(&args(), &key(1), &key(2), &key(3), 10_000),
            MandateError::AlreadyExpired,
        );
    }

    fn mandate(revoked: bool) -> Mandate {
        let a = args();
        Mandate {
            mandate_hash: a.mandate_hash,
            owner: key(1),
            approver: key(2),
            agent: key(3),
            gate_authority: a.gate_authority,
            mint: a.mint,
            max_per_payment: a.max_per_payment,
            max_per_window: a.max_per_window,
            window_seconds: a.window_seconds,
            max_total: a.max_total,
            escalation_threshold: a.escalation_threshold,
            not_before: a.not_before,
            expires_at: a.expires_at,
            created_at: 900,
            revoked,
            revoked_at: 0,
            revoked_by: Pubkey::default(),
            bump: 255,
        }
    }

    #[test]
    fn is_active_respects_validity_window_and_revocation() {
        let m = mandate(false);
        assert!(!m.is_active(999), "not yet valid");
        assert!(m.is_active(1_000));
        assert!(m.is_active(9_999));
        assert!(!m.is_active(10_000), "expired");
        assert!(!mandate(true).is_active(5_000), "revoked");
    }
}
