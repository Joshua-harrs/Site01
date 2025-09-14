import React, { useEffect, useState } from 'react';
import axios from 'axios';
const API = import.meta.env.VITE_API_URL || 'http://localhost:4000/api';

export default function App(){
  const [games, setGames] = useState([]);

const [locked, setLocked] = useState(true);
const [secretInput, setSecretInput] = useState('');

function getAccessToken(){ return localStorage.getItem('game_access_token'); }

async function unlock(){
  try{
    const res = await axios.post(API + '/unlock', { secret: secretInput });
    if(res.data.token){ localStorage.setItem('game_access_token', res.data.token); alert('Unlocked! Refresh to access games.'); setLocked(false); }
  }catch(e){ alert('Wrong secret'); }
}

useEffect(()=>{ (async()=>{ try{ const token=getAccessToken(); const res = await axios.get(API+'/games', { headers: token?{Authorization:`Bearer ${token}`}:{} }); setGames(res.data); setLocked(false); }catch(e){ setLocked(true); } })(); }, []);


  const [q, setQ] = useState('');
  const [selected, setSelected] = useState(null);

  useEffect(()=>{ fetchGames(); }, []);
  async function fetchGames(){ const res = await axios.get(API + '/games'); setGames(res.data); }

  return (
    <div style={{fontFamily:'system-ui',padding:20}}>
      <h1>Learning Games Hub</h1>\n      {locked && (\n        <div style={{background:'#fff3',padding:12,borderRadius:6,marginBottom:12}}>\n          <p>Games are locked. Enter secret to unlock.</p>\n          <input placeholder='Enter secret' value={secretInput} onChange={e=>setSecretInput(e.target.value)} />\n          <button onClick={unlock}>Unlock</button>\n        </div>\n      )}
      <div style={{marginBottom:10}}>
        <input placeholder='Search' value={q} onChange={e=>setQ(e.target.value)} />
        <button onClick={async()=>{ const res=await axios.get(API+'/games',{params:{q}}); setGames(res.data); }}>Search</button>
      </div>
      <div style={{display:'flex',gap:20}}>
        <div style={{width:300}}>
          <h3>Games</h3>
          <ul>
            {games.map(g=>(
              <li key={g._id}><button onClick={()=>setSelected(g)}>{g.title}</button></li>
            ))}
          </ul>
        </div>
        <div style={{flex:1}}>
          {selected ? (
            <div>
              <h2>{selected.title}</h2>
              <p>{selected.description}</p>
              {selected.filePath && (
                <div style={{border:'1px solid #ddd'}}>
                  {/* sandboxed iframe for safety */}
                  <iframe src={selected.filePath} title={selected.title} style={{width:'100%',height:420}} sandbox="allow-scripts allow-same-origin"></iframe>
                </div>
              )}
              <h3>Lesson: {selected.lesson?.title}</h3>
              <div dangerouslySetInnerHTML={{__html: selected.lesson?.content}} />
            </div>
          ) : <div>Select a game</div>}
        </div>
      </div>
    </div>
  );
}
