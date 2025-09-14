import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid } from 'recharts';
const API = import.meta.env.VITE_API_URL || 'http://localhost:4000/api';

export default function Admin(){
  const [token, setToken] = useState(localStorage.getItem('token')||'');
  const [role, setRole] = useState('');
  const [auth, setAuth] = useState({ email:'', password:'' });
  const [games, setGames] = useState([]);
  const [users, setUsers] = useState([]);
  const [comments, setComments] = useState([]);
  const [analytics, setAnalytics] = useState(null);

  useEffect(()=>{ if(token) fetchAdmin(); }, [token]);

  async function login(){
    const res = await axios.post(API + '/login', auth);
    if(res.data.token){ setToken(res.data.token); localStorage.setItem('token', res.data.token); setRole(res.data.role); }
  }

  async function fetchAdmin(){
    const headers = { Authorization: `Bearer ${token}` };
    try{
      const [g,u,c,a] = await Promise.all([ axios.get(API + '/admin/games', {headers}), axios.get(API + '/admin/users', {headers}), axios.get(API + '/admin/comments', {headers}), axios.get(API + '/admin/analytics', {headers}) ]);
      setGames(g.data); setUsers(u.data); setComments(c.data); setAnalytics(a.data);
    }catch(e){ console.error(e); alert('Failed fetching admin data'); }
  }

  async function approveComment(gameId, idx){
    await axios.post(API + `/admin/comments/${gameId}/${idx}/approve`, {}, { headers: { Authorization: `Bearer ${token}` } });
    fetchAdmin();
  }
  async function deleteComment(gameId, idx){
    await axios.delete(API + `/admin/comments/${gameId}/${idx}`, { headers: { Authorization: `Bearer ${token}` } });
    fetchAdmin();
  }

  return (
    <div style={{padding:20}}>
      <h1>Admin Dashboard</h1>
      {!token && (
        <div>
          <input placeholder='email' value={auth.email} onChange={e=>setAuth({...auth,email:e.target.value})} />
          <input placeholder='password' type='password' value={auth.password} onChange={e=>setAuth({...auth,password:e.target.value})} />
          <button onClick={login}>Login</button>
        </div>
      )}

      {token && (
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:20}}>
          <section style={{background:'#fff',padding:12,borderRadius:6}}>
            <h2>Games ({games.length})</h2>
            <ul>{games.map(g=> <li key={g._id}>{g.title} — {g.leaderboard?.length || 0} scores</li>)}</ul>
          </section>

          <section style={{background:'#fff',padding:12,borderRadius:6}}>
            <h2>Users ({users.length})</h2>
            <ul>{users.map(u=> <li key={u._id}>{u.email} — {u.role}</li>)}</ul>
          </section>

          <section style={{gridColumn:'1 / -1', background:'#fff', padding:12, borderRadius:6}}>
            <h2>Comments Moderation</h2>
            <ul>{comments.map((c,i)=> (
              <li key={i}><strong>{c.gameTitle}</strong>: {c.comment.text} — <button onClick={()=>approveComment(c.gameId, c.commentIndex||0)}>Approve</button> <button onClick={()=>deleteComment(c.gameId, c.commentIndex||0)}>Delete</button></li>
            ))}</ul>
          </section>

          <section style={{gridColumn:'1 / -1', background:'#fff', padding:12, borderRadius:6}}>
            <h2>Analytics</h2>
            {analytics && (
              <div>
                <p>Total games: {analytics.totalGames}</p>
                <p>Total users: {analytics.totalUsers}</p>
                <h3>Top Games</h3>
                <ol>{(analytics.topGames||[]).map(g=> <li key={g._id}>{g.title} — {g.leaderboard?.length || 0} scores</li>)}</ol>

                {/* Simple chart placeholder (time series would need backend support) */}
                <LineChart width={600} height={240} data={[{name:'A',value:12},{name:'B',value:20},{name:'C',value:8}]}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="name" />
                  <YAxis />
                  <Tooltip />
                  <Line type="monotone" dataKey="value" stroke="#8884d8" />
                </LineChart>
              </div>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
