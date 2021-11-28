import * as anchor from '@project-serum/anchor';
import { Program } from '@project-serum/anchor';
import { Quokka } from '../target/types/quokka';
import assert from "assert";
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
    const backend = anchor.web3.Keypair.generate();
    const alice = anchor.web3.Keypair.generate();
    const [invoiceAddress, bump] = await anchor.web3.PublicKey.findProgramAddress(
      [
        backend.publicKey.toBuffer(), 
        alice.publicKey.toBuffer(),
        Buffer.from(anchor.utils.bytes.utf8.encode(project_ts)) // Include project_id as seed (why )
      ],
      program.programId
    );
    await airdrop(backend.publicKey);
    await airdrop(alice.publicKey);
    return {
      backend,
      alice,
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
   * getBalances - Fetches the balances of backend, alice, and the invoice account.
   *
   * @returns {object} The balances
   */
  async function getBalances(accounts) {
    return {
      backend: await program.provider.connection.getBalance(accounts.backend.publicKey),
      alice: await program.provider.connection.getBalance(accounts.alice.publicKey),
      invoice: await program.provider.connection.getBalance(accounts.invoice.address),
    };
  }

  /**
   * issueInvoice - Issues an invoice with backend as creditor and alice as debtor.
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
        creditor: accounts.backend.publicKey,
        debtor: accounts.alice.publicKey,
        systemProgram: anchor.web3.SystemProgram.programId,
        clock: anchor.web3.SYSVAR_CLOCK_PUBKEY,
      },
      signers: [accounts.backend],
    });
  }
  it('Backend issues invoice to Alice', async () => {
    // Setup
    const accounts = await generateAccounts();

    // Test
    const amount = 5000
    console.log("backend initializes an invoice of", amount)
    const initialBalances = await getBalances(accounts);
    console.log("Issuing invoice...")
    await issueInvoice(accounts, amount);

    // Validate
    const invoice = await program.account.invoice.fetch(
      accounts.invoice.address
    );
    const finalBalances = await getBalances(accounts);
    assert.ok(
      invoice.creditor.toString() === accounts.backend.publicKey.toString()
    );
    assert.ok(invoice.debtor.toString() === accounts.alice.publicKey.toString());
    assert.ok(invoice.balance.toString() === amount.toString());
    assert.ok(invoice.memo === "Account's memo");
    assert.ok(
      finalBalances.backend === initialBalances.backend - finalBalances.invoice
    );
    assert.ok(finalBalances.alice === initialBalances.alice);
    assert.ok(
      finalBalances.invoice === initialBalances.backend - finalBalances.backend
    );
  });

  it("Alice pays invoice in part", async () => {
    // Setup
    const accounts = await generateAccounts();
    await issueInvoice(accounts, 1234);

    // Test
    const initialBalances = await getBalances(accounts);
    const amount = 1000;
    await program.rpc.pay(new anchor.BN(amount), {
      accounts: {
        invoice: accounts.invoice.address,
        creditor: accounts.backend.publicKey,
        debtor: accounts.alice.publicKey,
        systemProgram: anchor.web3.SystemProgram.programId,
      },
      signers: [accounts.alice],
    });

    // Validate
    const invoice = await program.account.invoice.fetch(
      accounts.invoice.address
    );
    const finalBalances = await getBalances(accounts);
    assert.ok(
      invoice.creditor.toString() === accounts.backend.publicKey.toString()
    );
    assert.ok(invoice.debtor.toString() === accounts.alice.publicKey.toString());
    assert.ok(invoice.balance.toString() === "234");
    assert.ok(invoice.memo === "Account's memo");
    assert.ok(finalBalances.backend === initialBalances.backend + amount);
    assert.ok(finalBalances.alice === initialBalances.alice - amount);
    assert.ok(finalBalances.invoice === initialBalances.invoice);
  });
  
});
