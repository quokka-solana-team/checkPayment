import * as anchor from "@project-serum/anchor";
import { Program } from "@project-serum/anchor";
import { Quokka } from "../target/types/quokka";
import assert from "assert";

const PRINT_ALL_LOGS = true;
const DEVNET_WAIT_TIME = 5000;

describe("quokka", () => {
  // Configure the client to use the local cluster.
  anchor.setProvider(anchor.Provider.env());

  const project_id = "juan3uxteK3E4ikyTeAg2AYRKzBS7CJ4dkGmx7zyHMv_123456";
  const project_ts = project_id.split("_")[1];

  const program = anchor.workspace.Quokka as Program<Quokka>;

  /**
   * generateAccounts - Generates keypairs and PDAs for participants and program accounts needed in a test case
   *
   * @returns {object} The accounts needed for a test case
   */
  async function generateAccounts() {
    const backend = anchor.web3.Keypair.generate();
    const alice = anchor.web3.Keypair.generate();
    const [invoiceAddress, bump] =
      await anchor.web3.PublicKey.findProgramAddress(
        [
          backend.publicKey.toBuffer(),
          alice.publicKey.toBuffer(),
          Buffer.from(anchor.utils.bytes.utf8.encode(project_ts)), // Include project_id as seed (why )
        ],
        program.programId
      );
    await new Promise((resolve) => setTimeout(resolve, DEVNET_WAIT_TIME));

    await airdrop(backend.publicKey);

    await new Promise((resolve) => setTimeout(resolve, DEVNET_WAIT_TIME));

    await airdrop(alice.publicKey, 5);
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
  async function airdrop(publicKey, amount = 1) {
    await program.provider.connection
      .requestAirdrop(publicKey, amount * anchor.web3.LAMPORTS_PER_SOL)
      .then((sig) =>
        program.provider.connection.confirmTransaction(sig, "confirmed")
      );
    await new Promise((resolve) => setTimeout(resolve, DEVNET_WAIT_TIME));
  }

  /**
   * getBalances - Fetches the balances of backend, alice, and the invoice account.
   *
   * @returns {object} The balances
   */
  async function getBalances(accounts) {
    await new Promise((resolve) => setTimeout(resolve, DEVNET_WAIT_TIME));

    return {
      backend: await program.provider.connection.getBalance(
        accounts.backend.publicKey
      ),
      alice: await program.provider.connection.getBalance(
        accounts.alice.publicKey
      ),
      invoice: await program.provider.connection.getBalance(
        accounts.invoice.address
      ),
    };
  }

  /**
   * issueInvoice - Issues an invoice with backend as creditor and alice as debtor.
   *
   * @param {object} accounts The accounts of the test case
   * @param {number} balance The invoice balance
   */
  async function issueInvoice(accounts, balance) {
    await program.rpc.issue(
      accounts.invoice.bump,
      new anchor.BN(balance),
      project_ts,
      {
        accounts: {
          invoice: accounts.invoice.address,
          creditor: accounts.backend.publicKey,
          debtor: accounts.alice.publicKey,
          systemProgram: anchor.web3.SystemProgram.programId,
          clock: anchor.web3.SYSVAR_CLOCK_PUBKEY,
        },
        signers: [accounts.backend],
      }
    );
  }

  async function getRentCost(space) {
    await new Promise((resolve) => setTimeout(resolve, DEVNET_WAIT_TIME));
    const lamports =
      await program.provider.connection.getMinimumBalanceForRentExemption(
        space
      );
    if (PRINT_ALL_LOGS) console.log("Lamport cost:", lamports);
    return lamports;
  }

  it("[Create] Backend issues invoice to Alice", async () => {
    // Setup
    const accounts = await generateAccounts();

    // Test
    const amount = 1 * anchor.web3.LAMPORTS_PER_SOL;
    if (PRINT_ALL_LOGS)
      console.log("backend initializes an invoice of", amount);
    const initialBalances = await getBalances(accounts);
    if (PRINT_ALL_LOGS) console.log("Issuing invoice...");

    const accSpace = 8 + 32 + 32 + 8 + 4 + project_ts.length + 8 + 8 + 4 + 1;
    await getRentCost(accSpace);

    await issueInvoice(accounts, amount);

    // Validate
    const invoice = await program.account.invoice.fetch(
      accounts.invoice.address
    );
    const finalBalances = await getBalances(accounts);
    assert.ok(
      invoice.creditor.toString() === accounts.backend.publicKey.toString()
    );
    assert.ok(
      invoice.debtor.toString() === accounts.alice.publicKey.toString()
    );
    assert.ok(invoice.balance.toString() === amount.toString());

    assert.ok(
      finalBalances.backend === initialBalances.backend - finalBalances.invoice
    );
    assert.ok(finalBalances.alice === initialBalances.alice);
    assert.ok(
      finalBalances.invoice === initialBalances.backend - finalBalances.backend
    );
  });

  it("[Pay] Alice pays invoice in part", async () => {
    // Setup
    const accounts = await generateAccounts();
    await issueInvoice(accounts, 1.2 * anchor.web3.LAMPORTS_PER_SOL);

    const accSpace = 8 + 32 + 32 + 8 + 4 + project_ts.length + 8 + 8 + 4 + 1;
    const accRentCost = await getRentCost(accSpace);
    // Test
    const initialBalances = await getBalances(accounts);
    if (PRINT_ALL_LOGS) console.log("Intial balances", initialBalances);
    const amount = 1 * anchor.web3.LAMPORTS_PER_SOL + accRentCost;
    if (PRINT_ALL_LOGS) console.log("paying", amount);

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
    if (PRINT_ALL_LOGS) console.log("final balances", finalBalances);
    assert.ok(
      invoice.creditor.toString() === accounts.backend.publicKey.toString(),
      "Invoice creditor is not the same as backend acct"
    );
    assert.ok(
      invoice.debtor.toString() === accounts.alice.publicKey.toString(),
      "Invoice payer is not Alice acct"
    );
    assert.ok(
      invoice.balance.toNumber() + accRentCost ==
        0.2 * anchor.web3.LAMPORTS_PER_SOL,
      `Invoice balance does not add up ${
        invoice.balance.toNumber() + accRentCost
      } vs ${0.2 * anchor.web3.LAMPORTS_PER_SOL}`
    );

    assert.ok(
      finalBalances.backend === initialBalances.backend + amount,
      `Backend balance doesnt add up ${finalBalances.backend} vs ${
        initialBalances.backend + amount
      }`
    );
    assert.ok(
      finalBalances.alice == initialBalances.alice - amount,
      `Alice balance doesnt add up ${finalBalances.alice} vs ${
        initialBalances.alice - amount
      }`
    );
    assert.ok(
      finalBalances.invoice === initialBalances.invoice,
      `??? ${finalBalances.invoice} vs ${initialBalances.invoice}`
    );
  });

  it("[Pay] Alice overpays invoice", async () => {
    // Setiup
    const accounts = await generateAccounts();
    await issueInvoice(accounts, 1.2 * anchor.web3.LAMPORTS_PER_SOL);

    const accSpace = 8 + 32 + 32 + 8 + 4 + project_ts.length + 8 + 8 + 4 + 1;
    const accRentCost = await getRentCost(accSpace);

    // Test
    const initialBalances = await getBalances(accounts);

    let amount = 1.2 * anchor.web3.LAMPORTS_PER_SOL + accRentCost;
    await program.rpc.pay(new anchor.BN(amount * 1.5), {
      accounts: {
        invoice: accounts.invoice.address,
        creditor: accounts.backend.publicKey,
        debtor: accounts.alice.publicKey,
        systemProgram: anchor.web3.SystemProgram.programId,
      },
      signers: [accounts.alice],
    });

    // Validate
    const finalBalances = await getBalances(accounts);
    if (PRINT_ALL_LOGS) console.log("Balances", finalBalances);
    assert.ok(
      finalBalances.backend + accRentCost ===
        initialBalances.backend +
          initialBalances.invoice +
          amount -
          accRentCost,
      `Backend balances do not back up ${
        finalBalances.backend + accRentCost
      } vs ${
        initialBalances.backend + initialBalances.invoice + amount - accRentCost
      }`
    );
    assert.ok(
      finalBalances.alice - accRentCost === initialBalances.alice - amount,
      `Alice balances do not add up ${finalBalances.alice - accRentCost} vs ${
        initialBalances.alice - amount
      }`
    );
  });

  it("[Pay] Alice pays invoice in full", async () => {
    // Setiup
    const accounts = await generateAccounts();
    await issueInvoice(accounts, 1.2 * anchor.web3.LAMPORTS_PER_SOL);

    const accSpace = 8 + 32 + 32 + 8 + 4 + project_ts.length + 8 + 8 + 4 + 1;
    const accRentCost = await getRentCost(accSpace);

    // Test
    const initialBalances = await getBalances(accounts);
    const amount = 1.2 * anchor.web3.LAMPORTS_PER_SOL + accRentCost;

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
    const finalBalances = await getBalances(accounts);
    if (PRINT_ALL_LOGS) console.log("Balances", finalBalances);
    if (PRINT_ALL_LOGS)
      console.log("Initial?", finalBalances.backend + finalBalances.invoice);
    assert.ok(
      finalBalances.backend + accRentCost ===
        initialBalances.backend +
          initialBalances.invoice +
          amount -
          accRentCost,
      `Backend balances do not back up ${
        finalBalances.backend + accRentCost
      } vs ${
        initialBalances.backend + initialBalances.invoice + amount - accRentCost
      }`
    );
    assert.ok(
      finalBalances.alice - accRentCost === initialBalances.alice - amount,
      `Alice balances do not add up ${finalBalances.alice - accRentCost} vs ${
        initialBalances.alice - amount
      }`
    );
    //assert.ok(finalBalances.invoice === 0); // --> Account has balance >0 to pay rent
  });

  it("[Confirm - Success] Backend confirms invoice", async () => {
    // Setiup
    const accounts = await generateAccounts();
    await issueInvoice(accounts, 1.2 * anchor.web3.LAMPORTS_PER_SOL);

    const accSpace = 8 + 32 + 32 + 8 + 4 + project_ts.length + 8 + 8 + 4 + 1;
    const accRentCost = await getRentCost(accSpace);

    // Test
    const initialBalances = await getBalances(accounts);
    const amount = 1.2 * anchor.web3.LAMPORTS_PER_SOL + accRentCost;

    await program.rpc.pay(new anchor.BN(amount), {
      accounts: {
        invoice: accounts.invoice.address,
        creditor: accounts.backend.publicKey,
        debtor: accounts.alice.publicKey,
        systemProgram: anchor.web3.SystemProgram.programId,
      },
      signers: [accounts.alice],
    });

    // Validate payment
    const finalBalances = await getBalances(accounts);
    if (PRINT_ALL_LOGS) console.log("Balances", finalBalances);
    if (PRINT_ALL_LOGS)
      console.log("Initial?", finalBalances.backend + finalBalances.invoice);
    assert.ok(
      finalBalances.backend + accRentCost ===
        initialBalances.backend +
          initialBalances.invoice +
          amount -
          accRentCost,
      `Backend balances do not back up ${
        finalBalances.backend + accRentCost
      } vs ${
        initialBalances.backend + initialBalances.invoice + amount - accRentCost
      }`
    );
    assert.ok(
      finalBalances.alice - accRentCost === initialBalances.alice - amount,
      `Alice balances do not add up ${finalBalances.alice - accRentCost} vs ${
        initialBalances.alice - amount
      }`
    );

    // Confirmation via backend

    const invoice_before = await program.account.invoice.fetch(
      accounts.invoice.address
    );

    await program.rpc.confirmSettlement({
      accounts: {
        invoice: accounts.invoice.address,
        creditor: accounts.backend.publicKey,
        debtor: accounts.alice.publicKey,
        clock: anchor.web3.SYSVAR_CLOCK_PUBKEY,
      },
      signers: [accounts.backend],
    });

    const invoice_after = await program.account.invoice.fetch(
      accounts.invoice.address
    );
    if (PRINT_ALL_LOGS) console.log("invoice before:", invoice_before);
    if (PRINT_ALL_LOGS) console.log("invoice after:", invoice_after);
  });

  it("[Confirm - Error] Alice wants to confirm invoice", async () => {
    // Setiup
    const accounts = await generateAccounts();
    await issueInvoice(accounts, 1.2 * anchor.web3.LAMPORTS_PER_SOL);

    const accSpace = 8 + 32 + 32 + 8 + 4 + project_ts.length + 8 + 8 + 4 + 1;
    const accRentCost = await getRentCost(accSpace);

    // Test
    const initialBalances = await getBalances(accounts);
    const amount = 1.2 * anchor.web3.LAMPORTS_PER_SOL + accRentCost;

    await program.rpc.pay(new anchor.BN(amount), {
      accounts: {
        invoice: accounts.invoice.address,
        creditor: accounts.backend.publicKey,
        debtor: accounts.alice.publicKey,
        systemProgram: anchor.web3.SystemProgram.programId,
      },
      signers: [accounts.alice],
    });

    // Validate payment
    const finalBalances = await getBalances(accounts);
    if (PRINT_ALL_LOGS) console.log("Balances", finalBalances);
    if (PRINT_ALL_LOGS)
      console.log("Initial?", finalBalances.backend + finalBalances.invoice);
    assert.ok(
      finalBalances.backend + accRentCost ===
        initialBalances.backend +
          initialBalances.invoice +
          amount -
          accRentCost,
      `Backend balances do not back up ${
        finalBalances.backend + accRentCost
      } vs ${
        initialBalances.backend + initialBalances.invoice + amount - accRentCost
      }`
    );
    assert.ok(
      finalBalances.alice - accRentCost === initialBalances.alice - amount,
      `Alice balances do not add up ${finalBalances.alice - accRentCost} vs ${
        initialBalances.alice - amount
      }`
    );

    // Confirmation via backend

    const invoice_before = await program.account.invoice.fetch(
      accounts.invoice.address
    );

    await assert.rejects(
      program.rpc.confirmSettlement({
        accounts: {
          invoice: accounts.invoice.address,
          creditor: accounts.backend.publicKey,
          debtor: accounts.alice.publicKey,
          clock: anchor.web3.SYSVAR_CLOCK_PUBKEY,
        },
        signers: [accounts.alice],
      }),
      {
        message: `unknown signer: ${accounts.alice.publicKey.toString()}`,
      }
    );

    const invoice_after = await program.account.invoice.fetch(
      accounts.invoice.address
    );
    if (PRINT_ALL_LOGS) console.log("invoice before:", invoice_before);
    if (PRINT_ALL_LOGS) console.log("invoice after:", invoice_after);
  });

  it("[Confirm - Error] Backend wants to confirm invoice that has not been paid", async () => {
    // Setiup
    const accounts = await generateAccounts();
    await issueInvoice(accounts, 1.2 * anchor.web3.LAMPORTS_PER_SOL);

    const accSpace = 8 + 32 + 32 + 8 + 4 + project_ts.length + 8 + 8 + 4 + 1;
    const accRentCost = await getRentCost(accSpace);

    // Test
    const initialBalances = await getBalances(accounts);
    const amount = 1.2 * anchor.web3.LAMPORTS_PER_SOL + accRentCost;

    // Confirmation via backend

    const invoice_before = await program.account.invoice.fetch(
      accounts.invoice.address
    );

    //
    //  -> Payment not happened :-(
    //

    await assert.rejects(
      program.rpc.confirmSettlement({
        accounts: {
          invoice: accounts.invoice.address,
          creditor: accounts.backend.publicKey,
          debtor: accounts.alice.publicKey,
          clock: anchor.web3.SYSVAR_CLOCK_PUBKEY,
        },
        signers: [accounts.backend],
      }),
      {
        message: `301: Tried to confirm an unsettled invoice`,
      }
    );

    const invoice_after = await program.account.invoice.fetch(
      accounts.invoice.address
    );
    if (PRINT_ALL_LOGS) console.log("invoice before:", invoice_before);
    if (PRINT_ALL_LOGS) console.log("invoice after:", invoice_after);
  });
});
