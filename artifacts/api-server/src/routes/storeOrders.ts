import { pool } from "@workspace/db";
let ready:Promise<void>|undefined;
export function ensureStoreOrders(){return ready??=pool.query(`CREATE TABLE IF NOT EXISTS store_orders (
  payment_id INTEGER PRIMARY KEY REFERENCES payments(id), gift BOOLEAN NOT NULL DEFAULT false,
  server_id TEXT NOT NULL DEFAULT 'solo-duo' CHECK(server_id IN ('solo-duo','trio'))
);`).then(()=>pool.query(`DO $$ BEGIN
  PERFORM pg_advisory_xact_lock(84032016);
  ALTER TABLE store_orders DROP CONSTRAINT IF EXISTS store_orders_server_id_check;
  ALTER TABLE store_orders ADD CONSTRAINT store_orders_server_id_check CHECK(server_id IN ('solo-duo','trio'));
END $$;`)).then(()=>{}).catch(e=>{ready=undefined;throw e});}
export async function recordStoreOrder(id:number,gift:boolean,serverId:string){
  await ensureStoreOrders();
  const {rows}=await pool.query(`INSERT INTO store_orders(payment_id,gift,server_id) VALUES($1,$2,$3)
    ON CONFLICT(payment_id) DO UPDATE SET payment_id=store_orders.payment_id RETURNING gift,server_id`,[id,gift,serverId]);
  if(rows[0].gift!==gift||rows[0].server_id!==serverId)throw Error('Tentativa de pagamento inválida. Inicie novamente.');
}
export async function storeOrder(id:number){await ensureStoreOrders();return(await pool.query('SELECT * FROM store_orders WHERE payment_id=$1',[id])).rows[0];}
export async function subscriptionServer(source:string):Promise<'solo-duo'|'trio'>{
 if(source==='manual:trio')return 'trio';
 const match=/^purchase:(\d+)$/.exec(source);
 if(!match)return 'solo-duo';
 return (await storeOrder(Number(match[1])))?.server_id==='trio'?'trio':'solo-duo';
}
