import * as anchor from '@project-serum/anchor';
import { Program } from '@project-serum/anchor';
import { Quokka } from '../target/types/quokka';

describe('quokka', () => {

  // Configure the client to use the local cluster.
  anchor.setProvider(anchor.Provider.env());

  const project_id = "juan3uxteK3E4ikyTeAg2AYRKzBS7CJ4dkGmx7zyHMv_123456"
  const project_ts = project_id.split("_")[1]

  const program = anchor.workspace.Quokka as Program<Quokka>;

  /**
   * generateAccounts - Generates keypairs and PDAs for participants and program accounts needed in a test case
   *
   * @returns {object} The accounts needed for a test case
   */
   async function generateAccounts() {
    const alice = anchor.web3.Keypair.generate();
    const bob = anchor.web3.Keypair.generate();
    const [invoiceAddress, bump] = await anchor.web3.PublicKey.findProgramAddress(
      [
        alice.publicKey.toBuffer(), 
        bob.publicKey.toBuffer(),
        Buffer.from(anchor.utils.bytes.utf8.encode(project_ts)) // Include project_id as seed (why )
      ],
      program.programId
    );
    await airdrop(alice.publicKey);
    await airdrop(bob.publicKey);
    return {
      alice,
      bob,
      invoice: { address: invoiceAddress, bump: bump },
    };
  }

  /**
   * airdrop - Airdrops SOL to an account.
   *
   * @param {PublicKey} publicKey
   */
  async function airdrop(publicKey) {
    await program.provider.connection
      .requestAirdrop(publicKey, anchor.web3.LAMPORTS_PER_SOL)
      .then((sig) => program.provider.connection.confirmTransaction(sig, "confirmed"));
  }

  /**
   * getBalances - Fetches the balances of Alice, Bob, and the invoice account.
   *
   * @returns {object} The balances
   */
  async function getBalances(accounts) {
    return {
      alice: await program.provider.connection.getBalance(accounts.alice.publicKey),
      bob: await program.provider.connection.getBalance(accounts.bob.publicKey),
      invoice: await program.provider.connection.getBalance(accounts.invoice.address),
    };
  }

  /**
   * issueInvoice - Issues an invoice with Alice as creditor and Bob as debtor.
   *
   * @param {object} accounts The accounts of the test case
   * @param {number} balance The invoice balance
   */
  async function issueInvoice(accounts, balance) {
    const memo = `Account's memo`;
    await program.rpc.issue(
      accounts.invoice.bump, 
      new anchor.BN(balance), 
      memo,
      project_ts, {
      accounts: {
        invoice: accounts.invoice.address,
        creditor: accounts.alice.publicKey,
        debtor: accounts.bob.publicKey,
        systemProgram: anchor.web3.SystemProgram.programId,
        clock: anchor.web3.SYSVAR_CLOCK_PUBKEY,
      },
      signers: [accounts.alice],
    });
  }
  it('Alice issues invoice', async () => {
    // Setup
    const accounts = await generateAccounts();

    // Test
    const amount = 5000
    console.log("Alice initializes an invoice of", amount)
    const initialBalances = await getBalances(accounts);
    console.log("Issuing invoice...")
    await issueInvoice(accounts, amount);
  });
});
