import { indexMediaRecord } from "../lib/search";
import { listMediaRecords } from "../lib/storage";

async function run(): Promise<void> {
  const records = await listMediaRecords();
  const completedRecords = records.filter((record) => record.status === "completed");

  console.log(`Found ${records.length} records total, ${completedRecords.length} completed to reindex.`);

  let successCount = 0;
  let failureCount = 0;

  for (const record of completedRecords) {
    try {
      await indexMediaRecord(record);
      successCount += 1;
      console.log(`Indexed ${record.id} (${record.fileName})`);
    } catch (error) {
      failureCount += 1;
      console.error(`Failed ${record.id} (${record.fileName})`, error);
    }
  }

  console.log(`Reindex complete. Success=${successCount} Failed=${failureCount}`);

  if (failureCount > 0) {
    process.exitCode = 1;
  }
}

run().catch((error) => {
  console.error("Reindex failed.", error);
  process.exitCode = 1;
});
