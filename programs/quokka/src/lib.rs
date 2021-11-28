   //! how we know the payer cannot cheat the system:
    //! 1. The program (server side) creates an invoice, with the seeds
    //! of the account being 
    //!     - the treasury address
    //!     - the payer address
    //!     - the project id
    //! 
    //! 2. We want the payer address to pay. This is why the payer
    //! address is the signer of the "pay" transaction. If any other 
    //! address pays, the system will not allow it
    //! 
    //! 3. After payer has paid, backend confirms by setting the "confirmed_at"
    //! variable on the account to the timestamp in which the backend confirmed
    //! the payer paid in full.
    //! 
    //! 5. Backend uploads files to arweave.
    //! 
    //! * What if they try to pay from different programs at the same time
    //! in the hopes of uploading multiple files?
    //!     - Different project_id: Since the system creates a new one
    //!         everytime a new upload is issued, the seeds won't match the 
    //!         given project_id and the program will fail
    //!     - Same project_id, different browsers: If the payer attempts
    //!         to upload multiple times by issuing an upload request with 
    //!         different browser instances referencing the same project_id,
    //!         only the first request will pass through. Since the backend
    //!         checks if the invoice balance is 0 (= has been paid) and 
    //!         updates the confirmed_at timestamp, if the timestamp is already
    //!         set, then that means the invoice has been already redeemed,
    //!         and the tx will fail
    //!     - Payer does not pay, goes directly into transaction confirmation:
    //!         In this case, it is irrelevant, since the balance will be positive
    //!         and the confirmed_at timestamp is not set, therefore causing the 
    //!         transaction to fail
    //!   

use {
    anchor_lang::{
        prelude::*,
        solana_program::{program::invoke, system_instruction, system_program},
        AnchorSerialize,
    },
    std::{clone::Clone, cmp::min},
};



declare_id!("9LjA6DjxKDB2uEQPH1kipq5L7Z2hRKGz2yd9EQD9fGhU");

#[program]
pub mod quokka {

    use super::*;
    pub fn issue(
        ctx: Context<Issue>, 
        bump: u8, 
        balance: u64, 
        memo: String,
        project_id: String
    ) -> ProgramResult {
        // Parse accounts from context
        let invoice = &mut ctx.accounts.invoice;
        let creditor = &ctx.accounts.creditor;
        let debtor = &ctx.accounts.debtor;
        let clock = &ctx.accounts.clock;
        
        // Intialize invoice account
        invoice.project_id = project_id;
        invoice.creditor = creditor.key();
        invoice.debtor = debtor.key();
        invoice.balance = balance;
        invoice.memo = memo; // TODO: Max limit on memo length?
        invoice.issued_at = clock.unix_timestamp;
        invoice.confirmed_at = 0;
        invoice.bump = bump;
        
        return Ok(());
    }


       
    pub fn pay(ctx: Context<Pay>, amount: u64) -> ProgramResult {
        // Parse accounts from context
        let invoice = &mut ctx.accounts.invoice;
        let debtor = &mut ctx.accounts.debtor;
        let creditor = &mut ctx.accounts.creditor;
        let system_program = &ctx.accounts.system_program;

        // Transfer SOL from the debtor to the creditor account
        let amount = min(amount, invoice.balance);

        // We accept every amount as long as it's the specified amount
        // or more - LOL
        require!(
            debtor.to_account_info().lamports() >= amount, 
            ErrorCode::NotEnoughSOL
        );
        invoke(
            &system_instruction::transfer(
                &debtor.key(), 
                &creditor.key(), 
                amount
            ),
            &[
                debtor.to_account_info().clone(),
                creditor.to_account_info().clone(),
                system_program.to_account_info().clone(),
            ],
        )?;

        // Update invoice balance: Important
        invoice.balance = invoice.balance - amount;

        return Ok(())
    }


     pub fn confirm_settlement(
        ctx: Context<ConfirmSettlement>
    ) -> ProgramResult {
        let invoice = &mut ctx.accounts.invoice;
        let clock = &ctx.accounts.clock;

        // This function marks the invoice as settled. It requires the 
        // invoice to have no balance, as it has been paid. This is 
        // just a confirmation step for the backend to be sure the user
        // has paid.
        require!(
            invoice.confirmed_at == 0,
            ErrorCode::AlreadySettled
        );

        // Require the invoice to be fully paid. 
        // If invoice is fully paid, close the invoice account
        require!(
            invoice.balance <= 0, 
            ErrorCode::UnsettledConfirmAttempt
        );
        
        invoice.confirmed_at = clock.unix_timestamp;

        return Ok(())

     }
}

#[derive(Accounts)]
#[instruction(bump: u8, amount: u64, memo: String, project_id:String)]
pub struct Issue<'info> {
    #[account(
        init,  
        // TODO: include project_id here as seed. This is done, so
        // the program can find the account in case of errors, or
        // if the user didnt pay in full. In that case, the user
        // should submit another tx with the remaining amount
        // => handled by frontend
        seeds = [
            creditor.key().as_ref(), 
            debtor.key().as_ref(),
            project_id.as_bytes()
        ],
        bump = bump,
        payer = creditor,
        space = 8 + 32 + 32 + 8 + 4 + memo.len() + 8 + 1,
    )]
    pub invoice: Account<'info, Invoice>,
    #[account(mut)]
    pub creditor: Signer<'info>,
    pub debtor: AccountInfo<'info>,
    #[account(address = system_program::ID)]
    pub system_program: Program<'info, System>,
    pub clock: Sysvar<'info, Clock>,
}

#[derive(Accounts)]
pub struct Pay<'info> {
    #[account(
        mut, 
        seeds = [
            creditor.key().as_ref(), 
            debtor.key().as_ref(),
            invoice.project_id.as_bytes()
        ],
        bump = invoice.bump,
        has_one = creditor,
        has_one = debtor,
    )]
    pub invoice: Account<'info, Invoice>,
    #[account(mut)]
    pub creditor: AccountInfo<'info>,
    #[account(mut)]
    pub debtor: Signer<'info>,
    #[account(address = system_program::ID)]
    pub system_program: Program<'info, System>,
}

// TODO: revise
#[derive(Accounts)]
pub struct ConfirmSettlement<'info> {
    #[account(
        mut, 
        seeds = [
            creditor.key().as_ref(), 
            debtor.key().as_ref(),
            invoice.project_id.as_bytes()
        ],
        bump = invoice.bump,
        has_one = creditor,
        has_one = debtor,
    )]
    pub invoice: Account<'info, Invoice>,
    #[account(mut)]
    pub creditor: Signer<'info>, // Here the creditor is the signer
    #[account(mut)]
    pub debtor: AccountInfo<'info>,
    pub clock: Sysvar<'info, Clock>,
}


#[account]
pub struct Invoice {
    pub project_id: String, // include project_id
    pub creditor: Pubkey,
    pub debtor: Pubkey,
    pub balance: u64,
    pub memo: String,
    pub issued_at: i64,
    pub confirmed_at: i64,
    pub bump: u8,
}


#[error]
pub enum ErrorCode {
    #[msg("Not enough SOL")]
    NotEnoughSOL,
    #[msg("Tried to confirm an unsettled invoice")]
    UnsettledConfirmAttempt,
    #[msg("Invoice already settled")]
    AlreadySettled
}
