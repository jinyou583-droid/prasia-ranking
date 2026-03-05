async function loadSnapshots(){

const res = await fetch("../snapshots/index.json")
const data = await res.json()

const select = document.getElementById("date")

data.snapshots.forEach(s=>{

const opt = document.createElement("option")
opt.value = s.date
opt.textContent = s.date

select.appendChild(opt)

})

loadRanking(select.value)

select.addEventListener("change",e=>{
loadRanking(e.target.value)
})

}

async function loadRanking(date){

const res = await fetch(`../snapshots/${date}.json`)
const data = await res.json()

const tbody = document.getElementById("rank")
tbody.innerHTML=""

data.rankings.forEach(r=>{

const tr = document.createElement("tr")

tr.innerHTML=`

<td>${r.rank}</td>
<td>${r.guild}</td>
<td>${r.server}</td>
<td>${r.score_total}</td>

`

tbody.appendChild(tr)

})

}

loadSnapshots()
