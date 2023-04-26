import {
  AccountInfo,
  AddressLookupTableAccount,
  AddressLookupTableProgram,
  PublicKey,
} from '@solana/web3.js';
import { GeyserProgramUpdateClient } from './geyser.js';
import { connection } from './connection.js';
import { logger } from './logger.js';

class LookupTableProvider {
  lookupTables: Map<string, AddressLookupTableAccount>;
  addressesForLookupTable: Map<string, Set<string>>;
  lookupTablesForAddress: Map<string, Set<string>>;
  geyserClient: GeyserProgramUpdateClient;

  constructor() {
    this.lookupTables = new Map();
    this.lookupTablesForAddress = new Map();
    this.addressesForLookupTable = new Map();
    this.geyserClient = new GeyserProgramUpdateClient(
      AddressLookupTableProgram.programId,
      this.processLookupTableUpdate.bind(this),
    );
  }

  private updateCache(
    lutAddress: PublicKey,
    lutAccount: AddressLookupTableAccount,
  ) {
    this.lookupTables.set(lutAddress.toBase58(), lutAccount);

    this.addressesForLookupTable.set(lutAddress.toBase58(), new Set());

    for (const address of lutAccount.state.addresses) {
      const addressStr = address.toBase58();
      this.addressesForLookupTable.get(lutAddress.toBase58()).add(addressStr);
      if (!this.lookupTablesForAddress.has(addressStr)) {
        this.lookupTablesForAddress.set(addressStr, new Set());
      }
      this.lookupTablesForAddress.get(addressStr).add(lutAddress.toBase58());
    }
  }

  private processLookupTableUpdate(
    lutAddress: PublicKey,
    data: AccountInfo<Buffer>,
  ) {
    const lutAccount = new AddressLookupTableAccount({
      key: lutAddress,
      state: AddressLookupTableAccount.deserialize(data.data),
    });

    this.updateCache(lutAddress, lutAccount);
    return;
  }

  async getLookupTable(
    lutAddress: PublicKey,
  ): Promise<AddressLookupTableAccount | null> {
    const lutAddressStr = lutAddress.toBase58();
    if (this.lookupTables.has(lutAddressStr)) {
      return this.lookupTables.get(lutAddressStr);
    }

    const lut = await connection.getAddressLookupTable(lutAddress);
    if (lut.value === null) {
      return null;
    }

    this.updateCache(lutAddress, lut.value);

    return lut.value;
  }

  computeIdealLookupTablesForAddresses(
    addresses: PublicKey[],
  ): AddressLookupTableAccount[] {
    const MIN_ADDRESSES_TO_INCLUDE_TABLE = 2;
    const MAX_TABLE_COUNT = 3;

    const startCalc = Date.now();

    const addressSet = new Set<string>();
    const tableIntersections = new Map<string, number>();
    const selectedTables: AddressLookupTableAccount[] = [];
    const remainingAddresses = new Set<string>();
    let numAddressesTakenCareOf = 0;

    for (const address of addresses) {
      const addressStr = address.toBase58();

      if (addressSet.has(addressStr)) continue;
      addressSet.add(addressStr);

      const tablesForAddress =
        this.lookupTablesForAddress.get(addressStr) || new Set();

      if (tablesForAddress.size === 0) continue;

      remainingAddresses.add(addressStr);

      for (const table of tablesForAddress) {
        const intersectionCount = tableIntersections.get(table) || 0;
        tableIntersections.set(table, intersectionCount + 1);
      }
    }

    const sortedIntersectionArray = Array.from(
      tableIntersections.entries(),
    ).sort((a, b) => b[1] - a[1]);

    for (const [lutKey, intersectionSize] of sortedIntersectionArray) {
      if (intersectionSize < MIN_ADDRESSES_TO_INCLUDE_TABLE) break;
      if (selectedTables.length >= MAX_TABLE_COUNT) break;
      if (remainingAddresses.size <= 1) break;

      const lutAddresses = this.addressesForLookupTable.get(lutKey);

      const addressMatches = new Set(
        [...remainingAddresses].filter((x) => lutAddresses.has(x)),
      );

      if (addressMatches.size >= MIN_ADDRESSES_TO_INCLUDE_TABLE) {
        selectedTables.push(this.lookupTables.get(lutKey));
        for (const address of addressMatches) {
          remainingAddresses.delete(address);
          numAddressesTakenCareOf++;
        }
      }
    }

    logger.info(
      `Reduced ${addressSet.size} different addresses to ${
        selectedTables.length
      } lookup tables from ${sortedIntersectionArray.length} (${
        this.lookupTables.size
      }) candidates, with ${
        addressSet.size - numAddressesTakenCareOf
      } missing addresses in ${Date.now() - startCalc}ms.`,
    );

    return selectedTables;
  }
}

const lookupTableProvider = new LookupTableProvider();

lookupTableProvider.getLookupTable(
  new PublicKey('JEDSEqf5NfpYwgANNCGqvbPm1f8UXbC3ktPjRSmvbqWP'),
);

export { lookupTableProvider };
