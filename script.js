// --- APP NAMESPACE ---
const app = {
    state: {
        calcMode: 'weekly',
        numberOfWeeks: 1,
        transactions: [],
        viewDate: new Date(),
        tempCalcResult: 0,
        chartInstance: null,
        optDataStore: [],
        openTableRows: []
    },

    init: function() {
        // Set View Date to current Monday
        const d = new Date();
        const day = d.getDay(), diff = d.getDate() - day + (day == 0 ? -6:1);
        app.state.viewDate = new Date(d.setDate(diff));
        document.getElementById('t-date').valueAsDate = new Date();

        this.storage.load();
        this.calc.setMode('weekly', document.querySelector('.segment-btn'));
        this.tracker.render();
        this.nav.init();
        
        // Listeners
        document.getElementById('calc-btn').addEventListener('click', () => app.calc.compute());
        document.getElementById('hourSlider').addEventListener('input', (e) => app.graph.handleSlider(e.target.value));
        
        // Sync inputs on change
        ['hourly', 'base-benefit', 'hpToggle', 'slToggle', 'ksToggle', 'ksPercent'].forEach(id => {
            document.getElementById(id).addEventListener('input', () => {
                app.storage.save();
                if(document.getElementById('tab-graph').classList.contains('active')) app.graph.update();
            });
        });
    },

    // --- NAVIGATION ---
    nav: {
        init: function() {
            document.querySelectorAll('.nav-item').forEach(el => {
                el.addEventListener('click', () => {
                    const tab = el.dataset.tab;
                    app.nav.switch(tab);
                });
            });
        },
        switch: function(tabName) {
            document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
            document.querySelector(`.nav-item[data-tab="${tabName}"]`).classList.add('active');

            ['calc', 'tracker', 'graph'].forEach(t => {
                const el = document.getElementById(`tab-${t}`);
                if(t === tabName) el.classList.remove('hidden');
                else el.classList.add('hidden');
            });

            const titles = { calc: 'Calculator', tracker: 'My Wallet', graph: 'Analysis' };
            document.getElementById('page-title').innerText = titles[tabName];
            
            if(tabName === 'graph') setTimeout(() => app.graph.update(), 100);
            if(tabName === 'tracker') document.getElementById('tracker-nav').classList.remove('hidden');
            else document.getElementById('tracker-nav').classList.add('hidden');
        }
    },

    // --- CALCULATOR ---
    calc: {
        setMode: function(mode, el) {
            app.state.calcMode = mode;
            document.querySelectorAll('.segment-btn').forEach(b => b.classList.remove('active'));
            if(el) el.classList.add('active');
            
            const customBox = document.getElementById('custom-weeks-container');
            if (mode === 'custom') customBox.classList.remove('hidden');
            else customBox.classList.add('hidden');
            
            this.renderInputs();
            document.getElementById('calc-output').classList.add('hidden');
        },

        renderInputs: function() {
            const container = document.getElementById('week-inputs-container');
            container.innerHTML = '';
            let weeks = app.state.calcMode === 'weekly' ? 1 : app.state.calcMode === 'fortnightly' ? 2 : parseInt(document.getElementById('custom-weeks-count').value) || 4;
            app.state.numberOfWeeks = weeks;

            for (let i = 1; i <= weeks; i++) {
                container.innerHTML += `
                    <div class="flex items-center gap-2">
                        <span class="text-xs font-bold w-12 opacity-60 uppercase">Week ${i}</span>
                        <input type="number" id="h${i}" placeholder="Hours" class="input-field text-center font-bold">
                    </div>`;
            }
        },

        compute: function() {
            const hourly = parseFloat(document.getElementById('hourly').value) || 0;
            const base = parseFloat(document.getElementById('base-benefit').value) || 401;
            const hp = document.getElementById('hpToggle').checked;
            const slOn = document.getElementById('slToggle').checked;
            const ksOn = document.getElementById('ksToggle').checked;
            const ksRate = parseFloat(document.getElementById('ksPercent').value);

            let totalNet = 0, totalBen = 0;
            let weeksData = [];

            for (let i = 1; i <= app.state.numberOfWeeks; i++) {
                const h = parseFloat(document.getElementById(`h${i}`).value) || 0;
                let gross = hourly * h * (hp ? 1.08 : 1);
                
                // Tax (Simple Approx for v17)
                let paye = 0, r = gross * 52;
                [[15600,0.105],[53500,0.175],[78100,0.30],[180000,0.33],[Infinity,0.39]].forEach(b=>{
                   let limit=b[0], prev=[[15600,0.105],[53500,0.175],[78100,0.30],[180000,0.33],[Infinity,0.39]].indexOf(b)>0?[[15600,0.105],[53500,0.175],[78100,0.30],[180000,0.33],[Infinity,0.39]][[[15600,0.105],[53500,0.175],[78100,0.30],[180000,0.33],[Infinity,0.39]].indexOf(b)-1][0]:0;
                   if(r>0){ let t=Math.min(r, limit-prev); paye+=t*b[1]; r-=t; }
                });
                paye/=52;
                
                let acc = Math.min(gross*52, 152790)*0.0167/52;
                let ks = ksOn ? gross*ksRate : 0;
                let sl = (slOn && gross > 464) ? (gross-464)*0.12 : 0;
                let net = gross - paye - acc - ks - sl;
                let reduction = gross > 160 ? (gross-160)*0.7 : 0;
                let finalBen = Math.max(0, base - reduction);

                totalNet += net; totalBen += finalBen;
                weeksData.push({i, gross, paye, acc, ks, sl, net, finalBen, reduction, base});
            }

            const grandTotal = totalNet + totalBen;
            app.state.tempCalcResult = grandTotal; // For bridge

            // Render Output
            const container = document.getElementById('results-container');
            let content = '';

            if (weeksData.length === 1) {
                content = app.calc.renderDeepDive(weeksData[0]);
            } else {
                content = weeksData.map(w => `
                    <details class="group border-b border-gray-200 dark:border-gray-800">
                        <summary class="flex justify-between items-center py-3 px-4 cursor-pointer hover:bg-gray-50 dark:hover:bg-white/5">
                            <span class="font-bold text-sm">Week ${w.i}</span>
                            <div class="flex items-center gap-2">
                                <span>$${(w.net + w.finalBen).toFixed(2)}</span>
                                <svg class="chevron w-4 h-4 opacity-40" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"></path></svg>
                            </div>
                        </summary>
                        <div class="bg-gray-100 dark:bg-white/5 px-4 pb-3 pt-2">
                            ${app.calc.renderDeepDive(w)}
                        </div>
                    </details>
                `).join('');
            }

            container.innerHTML = `
                <div class="ios-card border border-blue-100 dark:border-blue-900 shadow-lg">
                    <details class="group" open>
                        <summary class="flex justify-between items-center p-4 cursor-pointer hover:bg-gray-50 dark:hover:bg-white/5">
                            <div>
                                <div class="text-xs font-bold opacity-50 uppercase mb-1">Total Money In Hand</div>
                                <div class="font-black text-3xl text-blue-600 dark:text-blue-400">$${grandTotal.toFixed(2)}</div>
                            </div>
                            <svg class="chevron w-6 h-6 opacity-40" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"></path></svg>
                        </summary>
                        <div class="border-t border-gray-100 dark:border-gray-800">
                            ${content}
                        </div>
                    </details>
                </div>
            `;
            
            document.getElementById('calc-output').classList.remove('hidden');
            document.getElementById('calc-output').scrollIntoView({behavior:'smooth'});
        },

        renderDeepDive: function(d) {
            const wTotal = d.net + d.finalBen;
            return `
                <div class="grid grid-cols-2 gap-2 mt-2">
                    <div class="p-2 bg-white dark:bg-[#2C2C2E] rounded border border-gray-200 dark:border-gray-700">
                        <h4 class="text-[10px] font-bold text-blue-500 uppercase mb-1">Work Pay</h4>
                        <div class="text-[10px] space-y-1">
                            <div class="flex justify-between"><span>Gross</span><span>$${d.gross.toFixed(2)}</span></div>
                            <div class="flex justify-between text-red-500"><span>Tax</span><span>-$${d.paye.toFixed(2)}</span></div>
                            <div class="flex justify-between text-red-500"><span>ACC</span><span>-$${d.acc.toFixed(2)}</span></div>
                            <div class="flex justify-between text-orange-500"><span>Loan</span><span>-$${d.sl.toFixed(2)}</span></div>
                            <div class="border-t border-gray-300 dark:border-gray-600 pt-1 mt-1 font-bold flex justify-between">
                                <span>Net</span><span>$${d.net.toFixed(2)}</span>
                            </div>
                        </div>
                    </div>
                    <div class="p-2 bg-white dark:bg-[#2C2C2E] rounded border border-gray-200 dark:border-gray-700">
                        <h4 class="text-[10px] font-bold text-purple-500 uppercase mb-1">Benefit</h4>
                        <div class="text-[10px] space-y-1">
                            <div class="flex justify-between"><span>Base</span><span>$${d.base.toFixed(2)}</span></div>
                            <div class="flex justify-between text-red-500"><span>Loss</span><span>-$${d.reduction.toFixed(2)}</span></div>
                            <div class="border-t border-gray-300 dark:border-gray-600 pt-1 mt-1 font-bold flex justify-between">
                                <span>Final</span><span>$${d.finalBen.toFixed(2)}</span>
                            </div>
                        </div>
                    </div>
                </div>
                <button onclick="app.tracker.bank(${wTotal})" class="w-full mt-2 py-2 text-xs font-bold text-green-600 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg">
                    + Add to Tracker ($${wTotal.toFixed(2)})
                </button>
            `;
        }
    },

    // --- TRACKER ---
    tracker: {
        render: function() {
            const container = document.getElementById('tracker-list');
            container.innerHTML = '';
            
            // Filter by Week
            const start = new Date(app.state.viewDate);
            const end = new Date(start); end.setDate(end.getDate()+6);
            
            // Update Label
            const fmt = d => d.toLocaleDateString('en-NZ', {day:'numeric', month:'short'}).toUpperCase();
            const labelDiv = document.getElementById('tracker-nav');
            if(!labelDiv.innerHTML) {
                labelDiv.innerHTML = `
                    <button onclick="app.tracker.shift(-1)" class="p-2 opacity-60"><svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7"></path></svg></button>
                    <div class="text-xs font-bold uppercase" id="week-label"></div>
                    <button onclick="app.tracker.shift(1)" class="p-2 opacity-60"><svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7"></path></svg></button>
                `;
            }
            document.getElementById('week-label').innerText = `${fmt(start)} - ${fmt(end)}`;

            // Filter Txns
            const weekTxns = app.state.transactions.filter(t => {
                const d = new Date(t.date);
                return d >= start && d <= end;
            }).sort((a,b) => new Date(b.date) - new Date(a.date));

            // Calc Totals
            let income=0, expense=0;
            // Pre-calculate opening balance? Complex. Let's just sum current view for simplicity as requested "Current Balance"
            // Actually, "Current Balance" implies total money ever.
            let totalBalance = app.state.transactions.reduce((acc, t) => acc + (t.type==='income'?t.amount:-t.amount), 0);
            document.getElementById('wallet-balance').innerText = `$${totalBalance.toFixed(2)}`;

            if(weekTxns.length === 0) {
                container.innerHTML = '<div class="text-center opacity-40 mt-10 text-sm">No transactions this week.</div>';
                return;
            }

            weekTxns.forEach(t => {
                const date = new Date(t.date).toLocaleDateString('en-NZ', {day:'2-digit', month:'2-digit'});
                container.innerHTML += `
                    <div class="ios-card relative">
                        <div class="p-3 flex justify-between items-center cursor-pointer" onclick="this.nextElementSibling.classList.toggle('hidden')">
                            <div class="flex items-center gap-3">
                                <span class="text-xs font-mono opacity-50">[${date}]</span>
                                <span class="font-medium text-sm">${t.label}</span>
                            </div>
                            <div class="flex items-center gap-2">
                                <span class="font-bold text-sm ${t.type==='income'?'text-green-500':''}">${t.type==='income'?'+':'-'}$${t.amount.toFixed(2)}</span>
                                <button onclick="app.tracker.editModal(${t.id}); event.stopPropagation();" class="opacity-30 hover:opacity-100 px-2">⋮</button>
                            </div>
                        </div>
                        <!-- Details -->
                        <div class="hidden bg-gray-50 dark:bg-white/5 p-2 text-xs border-t border-gray-100 dark:border-gray-800">
                            <div class="flex justify-between"><span>Type:</span><span class="capitalize">${t.type}</span></div>
                            <div class="flex justify-between"><span>ID:</span><span>${t.id}</span></div>
                        </div>
                    </div>
                `;
            });
        },

        shift: function(dir) {
            app.state.viewDate.setDate(app.state.viewDate.getDate() + (dir*7));
            this.render();
        },

        openModal: function() {
            document.getElementById('addModal').classList.add('open');
            document.getElementById('modal-title').innerText = "Add Transaction";
            document.getElementById('t-id').value = "";
            document.getElementById('t-amount').value = "";
            document.getElementById('t-label').value = "";
            document.getElementById('t-date').valueAsDate = new Date();
            document.getElementById('delete-btn').classList.add('hidden');
            document.getElementById('save-btn').classList.remove('col-span-1');
            document.getElementById('save-btn').classList.add('col-span-2');
        },

        editModal: function(id) {
            const t = app.state.transactions.find(x => x.id === id);
            if(!t) return;
            this.openModal();
            document.getElementById('modal-title').innerText = "Edit Transaction";
            document.getElementById('t-id').value = t.id;
            document.getElementById('t-amount').value = t.amount;
            document.getElementById('t-type').value = t.type;
            document.getElementById('t-date').value = t.date;
            document.getElementById('t-label').value = t.label;
            document.getElementById('delete-btn').classList.remove('hidden');
            document.getElementById('save-btn').classList.remove('col-span-2');
            document.getElementById('save-btn').classList.add('col-span-1');
        },

        closeModal: function() { document.getElementById('addModal').classList.remove('open'); },

        saveTxn: function() {
            const id = document.getElementById('t-id').value;
            const amt = parseFloat(document.getElementById('t-amount').value);
            const type = document.getElementById('t-type').value;
            const date = document.getElementById('t-date').value;
            const label = document.getElementById('t-label').value || 'Untitled';

            if(isNaN(amt) || !date) return;

            if(id) {
                const idx = app.state.transactions.findIndex(x => x.id == id);
                if(idx !== -1) app.state.transactions[idx] = { id: parseInt(id), amount: amt, type, date, label };
            } else {
                app.state.transactions.push({ id: Date.now(), amount: amt, type, date, label });
            }
            app.storage.saveTxns();
            this.closeModal();
            this.render();
        },

        deleteTxn: function() {
            const id = document.getElementById('t-id').value;
            app.state.transactions = app.state.transactions.filter(x => x.id != id);
            app.storage.saveTxns();
            this.closeModal();
            this.render();
        },

        bank: function(amount) {
            this.openModal();
            document.getElementById('t-amount').value = amount.toFixed(2);
            document.getElementById('t-type').value = 'income';
            document.getElementById('t-label').value = 'Weekly Pay';
        }
    },

    // --- GRAPH ---
    graph: {
        update: function() {
            const hourly = parseFloat(document.getElementById('hourly').value) || 0;
            const base = parseFloat(document.getElementById('base-benefit').value) || 401;
            if (hourly === 0) return;

            // Re-calc 50 hours
            let labels = [], dataMoney = [], dataPoints = [];
            let sweetEnd = 0, deadEnd = 0;
            const hp = document.getElementById('hpToggle').checked;
            
            app.state.optDataStore = []; // Reset

            for(let h=0; h<=50; h++) {
                // Logic copy from calc (simplified for visual)
                let gross = hourly*h*(hp?1.08:1);
                let reduction = gross>160?(gross-160)*0.7:0;
                let ben = Math.max(0, base-reduction);
                // Tax Approx
                let tax = (gross*0.18); // General avg tax+acc+ks for speed in graph
                let net = gross - tax;
                let total = net + ben;
                
                labels.push(h);
                dataMoney.push(total);
                
                let zone = 'breakout';
                if(gross <= 160) { zone = 'sweet'; sweetEnd=h; }
                else if(ben > 0) { zone = 'dead'; deadEnd=h; }
                
                // Marginal
                let prev = h===0?0:app.state.optDataStore[h-1].total;
                let marg = total - prev;
                let sym = '';
                if(zone==='sweet' && (gross+hourly)>160) sym='🟢';
                if(zone==='dead' && marg<2) sym='🛑';
                if(zone==='breakout' && ben===0 && app.state.optDataStore[h-1].b>0) sym='🏁';

                app.state.optDataStore.push({h, total, marg, zone, sym, work:net, b:ben});
            }

            // Draw Chart
            const ctx = document.getElementById('optChart').getContext('2d');
            if(app.state.chartInstance) app.state.chartInstance.destroy();
            
            const grad = ctx.createLinearGradient(0,0,0,300);
            grad.addColorStop(0, 'rgba(0,122,255,0.4)');
            grad.addColorStop(1, 'rgba(0,122,255,0.05)');

            app.state.chartInstance = new Chart(ctx, {
                type: 'line',
                data: {
                    labels: labels,
                    datasets: [{
                        label: 'Total',
                        data: dataMoney,
                        borderColor: '#007AFF',
                        backgroundColor: grad,
                        fill: true,
                        pointRadius: 0,
                        tension: 0.3
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    scales: { x: {display:false}, y: {display:false} },
                    plugins: {
                        annotation: { annotations: {
                            sweet: { type:'box', xMin:0, xMax:sweetEnd, backgroundColor:'rgba(52,199,89,0.15)', borderWidth:0 },
                            dead: { type:'box', xMin:sweetEnd, xMax:deadEnd, backgroundColor:'rgba(255,59,48,0.1)', borderWidth:0 },
                            free: { type:'box', xMin:deadEnd, xMax:50, backgroundColor:'rgba(0,122,255,0.1)', borderWidth:0 }
                        }}, tooltip: {enabled:false}
                    }
                }
            });
            this.renderTable();
        },

        handleSlider: function(val) {
            const h = parseInt(val);
            const d = app.state.optDataStore[h];
            if(!d) return;
            
            // Popup
            const pop = document.getElementById('graphPopup');
            if(document.getElementById('popupToggle').checked && app.state.chartInstance) {
                const meta = app.state.chartInstance.getDatasetMeta(0);
                const pt = meta.data[h];
                if(pt) {
                    pop.style.left = `${pt.x}px`;
                    pop.style.top = `${pt.y}px`;
                    pop.innerHTML = `$${d.total.toFixed(0)}`;
                    pop.style.opacity = 1;
                }
            } else pop.style.opacity = 0;

            // Card
            const con = document.getElementById('selected-point-container');
            con.classList.remove('hidden');
            let color = d.zone==='sweet'?'green':d.zone==='dead'?'red':'blue';
            
            con.innerHTML = `
                <div class="ios-card border-2 border-${color}-200 p-4">
                    <div class="flex justify-between items-center mb-2">
                        <div class="font-bold text-xl">${h} Hours ${d.sym}</div>
                        <div class="text-xs uppercase font-bold text-${color}-500 bg-${color}-100 px-2 py-1 rounded-full">${d.zone}</div>
                    </div>
                    <div class="flex justify-between text-sm">
                        <span>Work: $${d.work.toFixed(0)}</span>
                        <span>Ben: $${d.b.toFixed(0)}</span>
                    </div>
                    <div class="mt-2 pt-2 border-t border-gray-100 dark:border-gray-700 font-black text-2xl text-center">
                        $${d.total.toFixed(2)}
                    </div>
                </div>
            `;
        },

        renderTable: function() {
            const t = document.getElementById('optimizer-table-body');
            t.innerHTML = '';
            app.state.optDataStore.forEach(d => {
                if(d.h===0) return;
                let bg = d.zone==='sweet'?'bg-green-50/50 dark:bg-green-900/20':d.zone==='dead'?'bg-red-50/50 dark:bg-red-900/20':'';
                t.innerHTML += `
                    <div class="opt-row ${bg}" onclick="this.nextElementSibling.classList.toggle('open')">
                        <div>${d.h}</div>
                        <div class="text-center">${d.sym}</div>
                        <div class="text-right">$${d.total.toFixed(0)}</div>
                        <div class="text-right text-xs">+$${d.marg.toFixed(2)}</div>
                        <div class="text-right text-[10px] uppercase opacity-50">${d.zone}</div>
                    </div>
                    <div class="opt-detail">
                        <div class="flex justify-between text-xs"><span>Work Net</span><span>$${d.work.toFixed(2)}</span></div>
                        <div class="flex justify-between text-xs"><span>Benefit</span><span>$${d.b.toFixed(2)}</span></div>
                    </div>
                `;
            });
        }
    },

    // --- STORAGE ---
    storage: {
        load: function() {
            const h = localStorage.getItem('nz_calc_hourly');
            if(h) document.getElementById('hourly').value = h;
            
            const b = localStorage.getItem('nz_calc_base_benefit');
            if(b) document.getElementById('base-benefit').value = b;

            const theme = localStorage.getItem('nz_calc_theme');
            if(theme) {
                document.getElementById('themeSelect').value = theme;
                app.storage.applyTheme(theme);
            }

            const tx = localStorage.getItem('nz_tracker_txns');
            if(tx) app.state.transactions = JSON.parse(tx);
        },
        save: function() {
            localStorage.setItem('nz_calc_hourly', document.getElementById('hourly').value);
            localStorage.setItem('nz_calc_base_benefit', document.getElementById('base-benefit').value);
            localStorage.setItem('nz_calc_theme', document.getElementById('themeSelect').value);
            this.applyTheme(document.getElementById('themeSelect').value);
        },
        saveTxns: function() {
            localStorage.setItem('nz_tracker_txns', JSON.stringify(app.state.transactions));
        },
        applyTheme: function(theme) {
            if(theme === 'dark') document.documentElement.classList.add('dark');
            else if(theme === 'light') document.documentElement.classList.remove('dark');
            else {
                if(window.matchMedia('(prefers-color-scheme: dark)').matches) document.documentElement.classList.add('dark');
                else document.documentElement.classList.remove('dark');
            }
        }
    }
};

app.init();