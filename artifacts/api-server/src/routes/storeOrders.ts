import { pool } from "@workspace/db";
let ready:Promise<void>|undefined;
export function ensureStoreOrders(){return ready??=pool.query(`CREATE TABLE IF NOT EXISTS store_orders (
  payment_id INTEGER PRIMARY KEY REFERENCES payments(id), gift BOOLEAN NOT NULL DEFAULT false,
  server_id TEXT NOT NULL DEFAULT 'solo-duo' CHECK(server_id='solo-duo')
)`).then(()=>{}).catch(e=>{ready=undefined;throw e});}
export async function recordStoreOrder(id:number,gift:boolean,serverId:string){
  await ensureStoreOrders();
  const {rows}=await pool.query(`INSERT INTO store_orders(payment_id,gift,server_id) VALUES($1,$2,$3)
    ON CONFLICT(payment_id) DO UPDATE SET payment_id=store_orders.payment_id RETURNING gift,server_id`,[id,gift,serverId]);
  if(rows[0].gift!==gift||rows[0].server_id!==serverId)throw Error('Tentativa de pagamento inválida. Inicie novamente.');
}
export async function storeOrder(id:number){await ensureStoreOrders();return(await pool.query('SELECT * FROM store_orders WHERE payment_id=$1',[id])).rows[0];}
