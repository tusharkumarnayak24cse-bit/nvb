const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const QRCode = require('qrcode');

const app = express();
const PORT = process.env.PORT || 3000;
const ADMIN_KEY = process.env.ADMIN_KEY || 'change-me-now';
const DB_PATH = path.join(__dirname, 'data', 'db.json');
const SESSION_DAYS = 30;

app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));

function readDb(){ return JSON.parse(fs.readFileSync(DB_PATH,'utf8')); }
function writeDb(db){ fs.writeFileSync(DB_PATH, JSON.stringify(db,null,2)); }
function uid(prefix){ return `${prefix}_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`; }
function clean(v){ return String(v ?? '').trim(); }
function normalizePhone(v){ return clean(v).replace(/\D/g,'').slice(-10); }
function publicUser(u){ return u ? {id:u.id,name:u.name,email:u.email,phone:u.phone,role:u.role,createdAt:u.createdAt} : null; }
function hashPassword(password, salt=crypto.randomBytes(16).toString('hex')){
  const hash = crypto.pbkdf2Sync(password, salt, 120000, 32, 'sha256').toString('hex');
  return {salt,hash};
}
function verifyPassword(password,user){ return hashPassword(password,user.passwordSalt).hash === user.passwordHash; }
function cookies(req){ return Object.fromEntries((req.headers.cookie||'').split(';').map(s=>s.trim()).filter(Boolean).map(v=>{const i=v.indexOf('=');return [decodeURIComponent(v.slice(0,i)),decodeURIComponent(v.slice(i+1))]})); }
function authUser(req){
  const token = cookies(req).ep_session; if(!token) return null;
  const db = readDb();
  const s = (db.sessions||[]).find(x=>x.token===token && new Date(x.expiresAt)>new Date());
  if(!s) return null;
  return db.users.find(u=>u.id===s.userId) || null;
}
function requireAuth(req,res,next){ const u=authUser(req); if(!u) return res.status(401).json({error:'Please log in first.'}); req.user=u; next(); }
function requireOrganizer(req,res,next){ const u=authUser(req); if(!u) return res.status(401).json({error:'Please log in first.'}); if(u.role!=='organizer') return res.status(403).json({error:'Organizer account required.'}); req.user=u; next(); }
function requireAdmin(req,res,next){ if(req.headers['x-admin-key']!==ADMIN_KEY) return res.status(401).json({error:'Invalid admin key'}); next(); }
function eventPublic(e){ const {ownerId,...rest}=e; return rest; }
function feeFor(subtotal){ return Math.round(Number(subtotal||0)*0.07); }

app.get('/api/health',(req,res)=>res.json({ok:true,version:'2.0.0',paymentMode:process.env.RAZORPAY_KEY_ID?'razorpay':'demo'}));

app.post('/api/auth/register',(req,res)=>{
  const name=clean(req.body.name), email=clean(req.body.email).toLowerCase(), phone=normalizePhone(req.body.phone), password=String(req.body.password||''), role=req.body.role==='organizer'?'organizer':'customer';
  if(!name||!email||phone.length<10||password.length<6) return res.status(400).json({error:'Enter name, valid email, 10-digit phone and password of at least 6 characters.'});
  const db=readDb(); db.users=db.users||[]; db.sessions=db.sessions||[];
  if(db.users.some(u=>u.email===email)) return res.status(409).json({error:'An account with this email already exists.'});
  const {salt,hash}=hashPassword(password);
  const user={id:uid('usr'),name,email,phone,role,passwordSalt:salt,passwordHash:hash,createdAt:new Date().toISOString()}; db.users.push(user);
  const token=crypto.randomBytes(32).toString('hex'); db.sessions.push({token,userId:user.id,expiresAt:new Date(Date.now()+SESSION_DAYS*86400000).toISOString()}); writeDb(db);
  res.setHeader('Set-Cookie',`ep_session=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_DAYS*86400}${process.env.NODE_ENV==='production'?'; Secure':''}`);
  res.status(201).json({message:'Account created.',user:publicUser(user)});
});

app.post('/api/auth/login',(req,res)=>{
  const email=clean(req.body.email).toLowerCase(), password=String(req.body.password||''); const db=readDb();
  const user=(db.users||[]).find(u=>u.email===email); if(!user||!verifyPassword(password,user)) return res.status(401).json({error:'Incorrect email or password.'});
  db.sessions=db.sessions||[]; const token=crypto.randomBytes(32).toString('hex'); db.sessions.push({token,userId:user.id,expiresAt:new Date(Date.now()+SESSION_DAYS*86400000).toISOString()}); writeDb(db);
  res.setHeader('Set-Cookie',`ep_session=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_DAYS*86400}${process.env.NODE_ENV==='production'?'; Secure':''}`);
  res.json({message:'Logged in.',user:publicUser(user)});
});
app.post('/api/auth/logout',(req,res)=>{ const token=cookies(req).ep_session; const db=readDb(); db.sessions=(db.sessions||[]).filter(s=>s.token!==token); writeDb(db); res.setHeader('Set-Cookie','ep_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0'); res.json({message:'Logged out.'}); });
app.get('/api/auth/me',(req,res)=>res.json({user:publicUser(authUser(req))}));

app.get('/api/events',(req,res)=>{ const db=readDb(); res.json(db.events.filter(e=>e.status==='approved').sort((a,b)=>Number(b.featured)-Number(a.featured)||a.date.localeCompare(b.date)).map(eventPublic)); });
app.get('/api/events/:id',(req,res)=>{ const e=readDb().events.find(e=>e.id===req.params.id&&e.status==='approved'); if(!e)return res.status(404).json({error:'Event not found.'}); res.json(eventPublic(e)); });

app.post('/api/organizer/events',requireOrganizer,(req,res)=>{
  const {title,city,venue,date,time,price,category,image,description,contact,capacity}=req.body;
  if(!clean(title)||!clean(city)||!clean(venue)||!clean(date)) return res.status(400).json({error:'Event name, city, venue and date are required.'});
  const db=readDb(); const event={id:uid('evt'),ownerId:req.user.id,title:clean(title),city:clean(city),venue:clean(venue),date:clean(date),time:clean(time)||'18:00',price:Math.max(0,Number(price||0)),capacity:Math.max(1,Number(capacity||100)),category:clean(category)||'Other',image:clean(image)||'https://images.unsplash.com/photo-1501281668745-f7f57925c3b4?auto=format&fit=crop&w=1200&q=80',description:clean(description),organizer:req.user.name,contact:clean(contact)||req.user.phone,status:'pending',featured:false,createdAt:new Date().toISOString()}; db.events.push(event); writeDb(db); res.status(201).json({message:'Event submitted for admin approval.',event});
});
app.get('/api/organizer/overview',requireOrganizer,(req,res)=>{
  const db=readDb(), events=db.events.filter(e=>e.ownerId===req.user.id), ids=new Set(events.map(e=>e.id)), bookings=db.bookings.filter(b=>ids.has(b.eventId));
  res.json({events,bookings:bookings.slice().reverse(),stats:{events:events.length,approved:events.filter(e=>e.status==='approved').length,tickets:bookings.filter(b=>b.status==='paid').reduce((s,b)=>s+b.quantity,0),gross:bookings.filter(b=>b.status==='paid').reduce((s,b)=>s+b.subtotal,0)}});
});
app.put('/api/organizer/events/:id',requireOrganizer,(req,res)=>{ const db=readDb(); const e=db.events.find(e=>e.id===req.params.id&&e.ownerId===req.user.id); if(!e)return res.status(404).json({error:'Event not found.'}); const fields=['title','city','venue','date','time','category','image','description','contact']; fields.forEach(k=>{if(req.body[k]!==undefined)e[k]=clean(req.body[k]);}); if(req.body.price!==undefined)e.price=Math.max(0,Number(req.body.price||0)); if(req.body.capacity!==undefined)e.capacity=Math.max(1,Number(req.body.capacity||1)); e.status='pending'; e.updatedAt=new Date().toISOString(); writeDb(db); res.json({message:'Event updated and sent for re-approval.',event:e}); });
app.delete('/api/organizer/events/:id',requireOrganizer,(req,res)=>{ const db=readDb(); const before=db.events.length; db.events=db.events.filter(e=>!(e.id===req.params.id&&e.ownerId===req.user.id)); if(db.events.length===before)return res.status(404).json({error:'Event not found.'}); writeDb(db); res.json({message:'Event deleted.'}); });

app.post('/api/bookings',requireAuth,(req,res)=>{
  const eventId=clean(req.body.eventId), qty=Math.max(1,Math.min(10,Number(req.body.quantity||1))); const db=readDb(); const event=db.events.find(e=>e.id===eventId&&e.status==='approved'); if(!event)return res.status(404).json({error:'Event not found.'});
  const sold=db.bookings.filter(b=>b.eventId===eventId&&b.status==='paid').reduce((s,b)=>s+b.quantity,0); if(sold+qty>Number(event.capacity||100)) return res.status(409).json({error:'Not enough tickets remaining.'});
  const subtotal=Number(event.price||0)*qty, platformFee=feeFor(subtotal), booking={id:uid('book'),eventId,userId:req.user.id,name:req.user.name,phone:req.user.phone,email:req.user.email,quantity:qty,subtotal,platformFee,total:subtotal+platformFee,status:event.price===0?'paid':'payment_pending',paymentProvider:event.price===0?'free':'demo',createdAt:new Date().toISOString()}; db.bookings.push(booking); writeDb(db);
  res.status(201).json({message:event.price===0?'Ticket confirmed.':'Booking created. Complete payment to activate ticket.',bookingCode:booking.id.toUpperCase(),bookingId:booking.id,total:booking.total,subtotal,platformFee,status:booking.status,paymentMode:process.env.RAZORPAY_KEY_ID?'razorpay':'demo'});
});
app.get('/api/my/bookings',requireAuth,(req,res)=>{ const db=readDb(); const items=db.bookings.filter(b=>b.userId===req.user.id).slice().reverse().map(b=>({...b,event:eventPublic(db.events.find(e=>e.id===b.eventId)||{})})); res.json(items); });

app.post('/api/payments/create-order',requireAuth,async(req,res)=>{
  const bookingId=clean(req.body.bookingId), db=readDb(), booking=db.bookings.find(b=>b.id===bookingId&&b.userId===req.user.id); if(!booking)return res.status(404).json({error:'Booking not found.'}); if(booking.status==='paid')return res.json({mode:'paid',bookingId});
  const keyId=process.env.RAZORPAY_KEY_ID, keySecret=process.env.RAZORPAY_KEY_SECRET;
  if(!keyId||!keySecret) return res.json({mode:'demo',bookingId,amount:booking.total,message:'Demo payment mode is active.'});
  try{
    const response=await fetch('https://api.razorpay.com/v1/orders',{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Basic '+Buffer.from(`${keyId}:${keySecret}`).toString('base64')},body:JSON.stringify({amount:Math.round(booking.total*100),currency:'INR',receipt:booking.id,notes:{bookingId:booking.id}})}); const order=await response.json(); if(!response.ok)return res.status(502).json({error:order.error?.description||'Could not create Razorpay order.'}); booking.razorpayOrderId=order.id; booking.paymentProvider='razorpay'; writeDb(db); res.json({mode:'razorpay',keyId,orderId:order.id,amount:order.amount,currency:order.currency,bookingId});
  }catch(e){res.status(502).json({error:'Payment provider unavailable.'});}
});
app.post('/api/payments/demo-complete',requireAuth,(req,res)=>{ if(process.env.RAZORPAY_KEY_ID)return res.status(403).json({error:'Demo payments are disabled.'}); const db=readDb(), b=db.bookings.find(x=>x.id===req.body.bookingId&&x.userId===req.user.id); if(!b)return res.status(404).json({error:'Booking not found.'}); b.status='paid'; b.paymentProvider='demo'; b.paidAt=new Date().toISOString(); writeDb(db); res.json({message:'Demo payment completed. Ticket activated.',bookingId:b.id}); });
app.post('/api/payments/verify',requireAuth,(req,res)=>{ const {razorpay_order_id,razorpay_payment_id,razorpay_signature,bookingId}=req.body; const secret=process.env.RAZORPAY_KEY_SECRET; if(!secret)return res.status(400).json({error:'Razorpay is not configured.'}); const expected=crypto.createHmac('sha256',secret).update(`${razorpay_order_id}|${razorpay_payment_id}`).digest('hex'); if(expected!==razorpay_signature)return res.status(400).json({error:'Payment signature verification failed.'}); const db=readDb(),b=db.bookings.find(x=>x.id===bookingId&&x.userId===req.user.id&&x.razorpayOrderId===razorpay_order_id); if(!b)return res.status(404).json({error:'Booking not found.'}); b.status='paid'; b.paymentProvider='razorpay'; b.paymentId=razorpay_payment_id; b.paidAt=new Date().toISOString(); writeDb(db); res.json({message:'Payment verified. Ticket activated.'}); });

app.get('/api/tickets/:bookingId/qr',requireAuth,async(req,res)=>{ const db=readDb(),b=db.bookings.find(x=>x.id===req.params.bookingId&&x.userId===req.user.id); if(!b||b.status!=='paid')return res.status(404).json({error:'Active ticket not found.'}); const payload=JSON.stringify({bookingId:b.id,eventId:b.eventId,userId:b.userId,qty:b.quantity}); const svg=await QRCode.toString(payload,{type:'svg',margin:1,width:320}); res.type('image/svg+xml').send(svg); });
app.get('/api/tickets/:bookingId',requireAuth,(req,res)=>{ const db=readDb(),b=db.bookings.find(x=>x.id===req.params.bookingId&&x.userId===req.user.id); if(!b)return res.status(404).json({error:'Ticket not found.'}); const e=db.events.find(x=>x.id===b.eventId); res.json({booking:b,event:eventPublic(e||{})}); });

app.post('/api/organizer/checkin',requireOrganizer,(req,res)=>{
  let bookingId=clean(req.body.bookingId||req.body.code);
  try{ if(bookingId.startsWith('{')) bookingId=JSON.parse(bookingId).bookingId||bookingId; }catch{}
  bookingId=bookingId.toLowerCase();
  const db=readDb(); const b=db.bookings.find(x=>x.id.toLowerCase()===bookingId);
  if(!b||b.status!=='paid') return res.status(404).json({error:'Paid ticket not found.'});
  const e=db.events.find(x=>x.id===b.eventId&&x.ownerId===req.user.id);
  if(!e) return res.status(403).json({error:'This ticket is not for one of your events.'});
  if(b.checkedInAt) return res.status(409).json({error:'Ticket already checked in.',checkedInAt:b.checkedInAt,booking:b,event:eventPublic(e)});
  b.checkedInAt=new Date().toISOString(); b.checkedInBy=req.user.id; writeDb(db);
  res.json({message:'Check-in successful.',booking:b,event:eventPublic(e)});
});

app.post('/api/promote',(req,res)=>{ const {name,phone,eventName,plan}=req.body; if(!clean(name)||normalizePhone(phone).length<10||!clean(eventName)||!clean(plan))return res.status(400).json({error:'Please fill all fields.'}); const db=readDb(); db.promotionLeads.push({id:uid('lead'),name:clean(name),phone:normalizePhone(phone),eventName:clean(eventName),plan:clean(plan),status:'new',createdAt:new Date().toISOString()}); writeDb(db); res.status(201).json({message:'Promotion request received.'}); });

app.get('/api/admin/overview',requireAdmin,(req,res)=>{ const db=readDb(); const paid=db.bookings.filter(b=>b.status==='paid'); res.json({approved:db.events.filter(e=>e.status==='approved').length,pending:db.events.filter(e=>e.status==='pending').length,bookings:db.bookings.length,paidBookings:paid.length,promotionLeads:db.promotionLeads.length,totalBookingValue:paid.reduce((s,b)=>s+Number(b.total||0),0),platformRevenue:paid.reduce((s,b)=>s+Number(b.platformFee||0),0),users:(db.users||[]).length,organizers:(db.users||[]).filter(u=>u.role==='organizer').length,events:db.events,recentBookings:db.bookings.slice(-20).reverse(),leads:db.promotionLeads.slice(-20).reverse()}); });
app.post('/api/admin/events/:id/approve',requireAdmin,(req,res)=>{ const db=readDb(),e=db.events.find(e=>e.id===req.params.id); if(!e)return res.status(404).json({error:'Event not found.'}); e.status='approved'; writeDb(db); res.json({message:'Event approved.'}); });
app.post('/api/admin/events/:id/featured',requireAdmin,(req,res)=>{ const db=readDb(),e=db.events.find(e=>e.id===req.params.id); if(!e)return res.status(404).json({error:'Event not found.'}); e.featured=!e.featured; writeDb(db); res.json({message:`Featured ${e.featured?'enabled':'disabled'}.`}); });

app.get('*',(req,res)=>res.sendFile(path.join(__dirname,'public','index.html')));
app.listen(PORT,()=>console.log(`EventPulse V2 running on http://localhost:${PORT}`));
