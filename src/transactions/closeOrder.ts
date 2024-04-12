import { Keypair } from "@mysten/sui.js/cryptography";
import { TransactionBlock } from "@mysten/sui.js/transactions";
import { getCoinSymbol } from "bucket-protocol-sdk";
import { dcaCloseEscrow } from "../lib/operation";
import { SuiClient } from "@mysten/sui.js/client";
import { logger } from "../lib/logger";
import { Dca } from "@prisma/client";
import { ErrorCode } from "../type";
import { DCA_PACKAGE } from "../constants";
import { extractErrorMessage } from "../utils";
import { getTransaction } from "../getter";

export const closeOrder = async (
    client: SuiClient,
    signer: Keypair,
    escrow: Dca,
) => {
    const senderAddress = signer.toSuiAddress();

    const { escrowId, inputType, outputType } = escrow;

    const inputToken = getCoinSymbol(inputType);
    const outputToken = getCoinSymbol(outputType);
    if (!inputToken || !outputToken) {
        return;
    }

    // Update price oracle for input & output pair
    const tx = new TransactionBlock();
    // Close order
    const [coinIn, coinOut] = dcaCloseEscrow(tx, {
        inputType,
        outputType,
        escrowId,
    });
    tx.transferObjects(
        [coinIn, coinOut],
        tx.pure(senderAddress, "address"),
    );

    const result = await client.devInspectTransactionBlock({
        transactionBlock: tx,
        sender: senderAddress,
    });

    if (result.effects.status.status == "success") {
        const resp = await client.signAndExecuteTransactionBlock({
            transactionBlock: tx,
            signer,
        });
        const digest = resp.digest;

        // get transaction validate
        const transaction = await getTransaction(client, digest);
        if (!transaction) {
            return {
                status: ErrorCode.FAILED_FETCH,
            };
        }

        const events = transaction.events?.filter(t => t.packageId == DCA_PACKAGE);
        logger.info({ action: "closeOrder", escrow: escrow.escrowId, digest });

        return {
            status: ErrorCode.SUCCESS,
            data: {
                digest,
                events,
                checkpoint: transaction.checkpoint,
                timestamp: new Date(Number(transaction.timestampMs))
            }
        };
    } else {
        // Error handling
        // tx.blockData.transactions.forEach((tx, id) => console.log(id, tx));
        if (result.effects.status.error) {
            const [functionName, errorCode] = extractErrorMessage(
                result.effects.status.error,
            );

            // Error
            if (functionName == "close_order") {
                return {
                    status: errorCode,
                };
            }

            logger.error({ action: "closeOrder", error: errorCode },);
        }
    }
}