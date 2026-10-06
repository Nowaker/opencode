import { Database } from "bun:sqlite"

using db = new Database(process.argv[2])
db.exec("BEGIN IMMEDIATE")
process.stdout.write("locked\n")
await Bun.sleep(Number(process.argv[3]))
db.exec("ROLLBACK")
