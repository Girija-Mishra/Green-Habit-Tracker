// Frontend script for Green Habit Tracker (talks to /api/* endpoints)
async function initAuth(){
  try {
    const res = await fetch('/api/me');
    const data = await res.json();
    const authBox = document.getElementById('authBox');
    if (!data.loggedIn) {
      authBox.innerHTML = `<p><a href="login.html">Login</a> or <a href="signup.html">Sign up</a> to use the tracker.</p>`;
      document.getElementById('appBox').style.display = 'none';
    } else {
      authBox.innerHTML = `<p>Signed in as <strong>${data.user.username}</strong></p>`;
      document.getElementById('appBox').style.display = 'block';
      await loadTask();
    }
  } catch(e){
    console.error(e);
    document.getElementById('authBox').innerText = 'Error checking login state.';
  }
}

async function loadTask(){
  try {
    const res = await fetch('/api/task');
    if (!res.ok) return window.location.href = '/login.html';
    const data = await res.json();
    document.getElementById('task').innerText = data.task;
  } catch(e){
    console.error(e);
  }
}

async function saveTask(){
  const checkbox = document.getElementById('taskDone');
  const status = document.getElementById('status');
  const done = checkbox.checked;
  if (!done) {
    status.innerText = '❌ Mark the checkbox to claim your reward.';
    setTimeout(()=> status.innerText = '', 2000);
    return;
  }
  try {
    const res = await fetch('/api/task', { method:'POST' });
    const data = await res.json();
    if (res.ok) {
      // On success show reward and redirect to rewards page
      status.innerText = '✅ Task saved! ' + (data.reward || '');
      setTimeout(()=> window.location.href = '/rewards.html', 800);
    } else {
      status.innerText = data.error || data.message || 'Could not save';
      setTimeout(()=> status.innerText = '', 2000);
    }
  } catch(e){
    console.error(e);
    status.innerText = 'Network error';
  }
}

async function loadEcoTip(){
  try {
    const res = await fetch('/api/tip');
    const data = await res.json();
    document.getElementById('ecoTip').innerText = data.tip || 'Try to reuse items';
  } catch(e){
    console.error(e);
    document.getElementById('ecoTip').innerText = 'Could not load tip';
  }
}

async function loadRewards(){
  try {
    const res = await fetch('/api/rewards');
    const data = await res.json();
    const list = document.getElementById('rewardsList');
    list.innerHTML = '';
    if (!data.rewards || data.rewards.length === 0) {
      list.innerHTML = '<li>No rewards yet — complete the Task of the Day to earn rewards.</li>';
    } else {
      data.rewards.forEach(r => {
        const el = document.createElement('li');
        el.innerText = `${r.text} (${r.date})`;
        list.appendChild(el);
      });
    }
    const total = document.getElementById('totalRewards');
    total.innerText = `Total rewards: ${data.rewards ? data.rewards.length : 0}`;
  } catch(e){
    console.error(e);
    document.getElementById('rewardsList').innerHTML = '<li>Error loading rewards</li>';
  }
}
