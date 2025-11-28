// --- CONSTANTS (Configuration) ---
// Update these values when NZ Government legislation changes
const NZ_CONFIG = {
    TAX_BRACKETS: [
        { limit: 15600, rate: 0.105 },
        { limit: 53500, rate: 0.175 },
        { limit: 78100, rate: 0.30 },
        { limit: 180000, rate: 0.33 },
        { limit: Infinity, rate: 0.39 }
    ],
    ACC: {
        RATE: 0.016, // 1.6% (Approximate for 2024/25)
        CAP: 142283 // Max earnings liable for ACC
    },
    STUDENT_LOAN: {
        THRESHOLD_WEEKLY: 465, // Repayment threshold
        RATE: 0.12
    },
    BENEFIT_ABATEMENT: {
        FREE_ZONE: 160,
        REDUCTION_RATE: 0.70 // 70 cents per dollar
    }
};

// --- APP NAMESPACE ---
const app = {
    state: {
        calcMode: 'weekly',
        numberOfWeeks: 1,
        transactions: [],
        viewDate: new Date(),
        chartInstance: null,
        optDataStore: []
    },

    init: function() {
        // Initialize View Date to current Monday
        const d = new Date();
        const day = d.getDay(), diff = d.getDate() - day + (day == 0 ? -6:1);
        app.state.viewDate = new Date(d.setDate(diff));
        
        // Initialize Date Input defaults
        const dateInput = document.getElementById('t-date');
        if(dateInput) dateInput.valueAsDate = new Date();

        this.storage.load();
        
        // Render Initial UI
        this.calc.setMode('weekly');
        this.tracker.render();
        this.nav.init();
        
        // --- EVENT LISTENERS ---
        
        // 1. Calculator Inputs & Buttons
        document.getElementById('calc-btn').addEventListener('click', () => app.calc.compute());
        
        const modeButtons = {
            'mode-weekly': 'weekly',
            'mode-fortnightly': 'fortnightly',
            'mode-custom': 'custom'
        };
        for (const [id, mode] of Object.entries(modeButtons)) {
            document.getElementById(id).addEventListener('click', (e) => app.calc.setMode(mode, e.target));
        }

        // 2. Settings & Sliders (Auto-save & Update Graph)
        const autoUpdateInputs = ['hourly', 'base-benefit', 'hpToggle', 'slToggle', 'ksToggle', 'ksPercent', 'custom-weeks-count'];
        autoUpdateInputs.forEach(id => {
            document.getElementById(id).addEventListener('input', () => {
                app.storage.save();
                if(!document.getElementById('tab-graph').classList.contains('hidden')) app.graph.update();
                if(id === 'custom-weeks-count') app.calc.renderInputs(); // Refresh week rows
            });
        });
        
        document.getElementById('themeSelect').addEventListener('change', () => app.storage.save());
        
        // 3. Tracker Modals
        document.getElementById('add-txn-fab').addEventListener('click', () => app.tracker.openModal());
        document.getElementById('modal-close-btn').addEventListener('click', () => app.tracker.closeModal());
        document.getElementById('save-btn').addEventListener('click', () => app.tracker.saveTxn());
        document.getElementById('delete-btn').addEventListener('click', () => app.tracker.deleteTxn());
        
        // 4. Graph Interactions
        document.getElementById('hourSlider').addEventListener('input', (e) => app.graph.handleSlider(e.target.value));
        document.getElementById('ghostToggle').addEventListener('change', () => app.graph.update());
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
            
            if(tabName === 'graph') setTimeout(() => app.graph.update(), 50);
            
            const trackerNav = document.getElementById('tracker-nav');
            if(tabName === 'tracker') trackerNav.classList.remove('hidden');
            else trackerNav.classList.add('hidden');
        }
    },

    // --- TAX ENGINE (The Brain) ---
    engine: {
        calculatePaye: function(annualGross) {
            let tax = 0;
            let remainingIncome = annualGross;
            let previousLimit = 0;

            for (const bracket of NZ_CONFIG.TAX_BRACKETS) {
                if (remainingIncome <= 0) break;

                const taxableInThisBracket = Math.min(remainingIncome, bracket.limit - previousLimit);
                tax += taxableInThisBracket * bracket.rate;
                
                remainingIncome -= taxableInThisBracket;
                previousLimit = bracket.limit;
            }
            return tax; // Annual Tax
        },

        calculateDeductions: function(weeklyGross, settings) {
            const annualGross = weeklyGross * 52;
            
            // 1. PAYE (Annualized then /52)
            const annualTax = this.calculatePaye(annualGross);
            const weeklyPaye = annualTax / 52;

            // 2. ACC
            const liableEarnings = Math.min(annualGross, NZ_CONFIG.ACC.CAP);
            const weeklyAcc = (liableEarnings * NZ_CONFIG.ACC.RATE) / 52;

            // 3. Student Loan
            let weeklySl = 0;
            if (settings.hasLoan && weeklyGross > NZ_CONFIG.STUDENT_LOAN.THRESHOLD_WEEKLY) {
                weeklySl = (weeklyGross - NZ_CONFIG.STUDENT_LOAN.THRESHOLD_WEEKLY) * NZ_CONFIG.STUDENT_LOAN.RATE;
            }

            // 4. KiwiSaver
            const weeklyKs = settings.hasKs ? weeklyGross * settings.ksRate : 0;

            return {
                paye: weeklyPaye,
                acc: weeklyAcc,
                sl: weeklySl,
                ks: weeklyKs,
                total: weeklyPaye + weeklyAcc + weeklySl + weeklyKs
            };
        },

        calculateAbatement: function(weeklyGross, baseBenefit) {
            if (weeklyGross <= NZ_CONFIG.BENEFIT_ABATEMENT.FREE_ZONE) return baseBenefit;
            
            const reduction = (weeklyGross - NZ_CONFIG.BENEFIT_ABATEMENT.FREE_ZONE) * NZ_CONFIG.BENEFIT_ABATEMENT.REDUCTION_RATE;
            return Math.max(0, baseBenefit - reduction);
        }
    },

    // --- CALCULATOR UI ---
    calc: {
        setMode: function(mode, btnElement) {
            app.state.calcMode = mode;
            
            // Update UI Buttons
            document.querySelectorAll('.segment-btn').forEach(b => {
                b.classList.remove('active', 'bg-white', 'dark:bg-gray-700', 'shadow-sm');
                b.classList.add('opacity-60');
            });
            if(btnElement) {
                btnElement.classList.add('active', 'bg-white', 'dark:bg-gray-700', 'shadow-sm');
                btnElement.classList.remove('opacity-60');
            }

            // Toggle Custom Input
            const customBox = document.getElementById('custom-weeks-container');
            if (mode === 'custom') customBox.classList.remove('hidden');
            else customBox.classList.add('hidden');
            
            this.renderInputs();
            document.getElementById('calc-output').classList.add('hidden');
        },

        renderInputs: function() {
            const container = document.getElementById('week-inputs-container');
            container.innerHTML = '';
            
            let weeks = 1;
            if(app.state.calcMode === 'fortnightly') weeks = 2;
            if(app.state.calcMode === 'custom') weeks = parseInt(document.getElementById('custom-weeks-count').value) || 1;
            
            app.state.numberOfWeeks = weeks;

            for (let i = 1; i <= weeks; i++) {
                const div = document.createElement('div');
                div.className = "flex items-center gap-2";
                div.innerHTML = `
                    <span class="text-xs font-bold w-12 opacity-60 uppercase">Week ${i}</span>
                    <input type="number" id="h${i}" placeholder="Hours" class="input-field text-center font-bold">
                `;
                container.appendChild(div);
            }
        },

        compute: function() {
            // Gather Settings
            const hourlyRate = parseFloat(document.getElementById('hourly').value) || 0;
            const baseBenefit = parseFloat(document.getElementById('base-benefit').value) || 0;
            const settings = {
                hasHp: document.getElementById('hpToggle').checked,
                hasLoan: document.getElementById('slToggle').checked,
                hasKs: document.getElementById('ksToggle').checked,
                ksRate: parseFloat(document.getElementById('ksPercent').value)
            };

            let totalNet = 0;
            let weeksData = [];

            for (let i = 1; i <= app.state.numberOfWeeks; i++) {
                const hoursInput = document.getElementById(`h${i}`);
                const hours = parseFloat(hoursInput ? hoursInput.value : 0) || 0;
                
                // 1. Calculate Gross
                const gross = hourlyRate * hours * (settings.hasHp ? 1.08 : 1);
                
                // 2. Calculate Deductions (Tax, SL, KS)
                const ded = app.engine.calculateDeductions(gross, settings);
                const netPay = gross - ded.total;

                // 3. Calculate Benefit
                const benefit = app.engine.calculateAbatement(gross, baseBenefit);
                const reduction = baseBenefit - benefit;

                totalNet += (netPay + benefit);
                weeksData.push({ i, gross, ...ded, netPay, benefit, reduction, baseBenefit });
            }

            this.renderResults(weeksData, totalNet);
        },

        renderResults: function(weeksData, grandTotal) {
            const container = document.getElementById('results-container');
            
            // Helper to create HTML for one week detail
            const createDetailHTML = (w) => `
                <div class="grid grid-cols-2 gap-2 mt-2">
                    <div class="p-2 bg-white dark:bg-[#2C2C2E] rounded border border-gray-200 dark:border-gray-700">
                        <h4 class="text-[10px] font-bold text-blue-500 uppercase mb-1">Work Pay</h4>
                        <div class="text-[10px] space-y-1">
                            <div class="flex justify-between"><span>Gross</span><span>$${w.gross.toFixed(2)}</span></div>
                            <div class="flex justify-between text-red-500"><span>PAYE</span><span>-$${w.paye.toFixed(2)}</span></div>
                            <div class="flex justify-between text-red-500"><span>ACC</span><span>-$${w.acc.toFixed(2)}</span></div>
                            ${w.sl > 0 ? `<div class="flex justify-between text-orange-500"><span>Loan</span><span>-$${w.sl.toFixed(2)}</span></div>` : ''}
                            ${w.ks > 0 ? `<div class="flex justify-between text-orange-500"><span>KS</span><span>-$${w.ks.toFixed(2)}</span></div>` : ''}
                            <div class="border-t border-gray-300 dark:border-gray-600 pt-1 mt-1 font-bold flex justify-between">
                                <span>Net</span><span>$${w.netPay.toFixed(2)}</span>
                            </div>
                        </div>
                    </div>
                    <div class="p-2 bg-white dark:bg-[#2C2C2E] rounded border border-gray-200 dark:border-gray-700">
                        <h4 class="text-[10px] font-bold text-purple-500 uppercase mb-1">Benefit</h4>
                        <div class="text-[10px] space-y-1">
                            <div class="flex justify-between"><span>Base</span><span>$${w.baseBenefit.toFixed(2)}</span></div>
                            <div class="flex justify-between text-red-500"><span>Loss</span><span>-$${w.reduction.toFixed(2)}</span></div>
                            <div class="border-t border-gray-300 dark:border-gray-600 pt-1 mt-1 font-bold flex justify-between">
                                <span>Final</span><span>$${w.benefit.toFixed(2)}</span>
                            </div>
                        </div>
                    </div>
                </div>
                <button onclick="app.tracker.bank(${(w.netPay + w.benefit).toFixed(2)})" class="w-full mt-2 py-2 text-xs font-bold text-green-600 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg">
                    + Add to Tracker ($${(w.netPay + w.benefit).toFixed(2)})
                </button>
            `;

            let contentHTML = '';
            
            if (weeksData.length === 1) {
                contentHTML = createDetailHTML(weeksData[0]);
            } else {
                weeksData.forEach(w => {
                    contentHTML += `
                    <details class="group border-b border-gray-200 dark:border-gray-800">
                        <summary class="flex justify-between items-center py-3 px-4 cursor-pointer hover:bg-gray-50 dark:hover:bg-white/5">
                            <span class="font-bold text-sm">Week ${w.i}</span>
                            <div class="flex items-center gap-2">
                                <span>$${(w.netPay + w.benefit).toFixed(2)}</span>
                                <svg class="chevron w-4 h-4 opacity-40" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"></path></svg>
                            </div>
                        </summary>
                        <div class="bg-gray-100 dark:bg-white/5 px-4 pb-3 pt-2">
                            ${createDetailHTML(w)}
                        </div>
                    </details>`;
                });
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
                            ${contentHTML}
                        </div>
                    </details>
                </div>
            `;
            
            document.getElementById('calc-output').classList.remove('hidden');
            document.getElementById('calc-output').scrollIntoView({behavior:'smooth'});
        }
    },

    // --- TRACKER ---
    tracker: {
        render: function() {
            const container = document.getElementById('tracker-list');
            container.innerHTML = '';
            
            // Navigation Label
            const start = new Date(app.state.viewDate);
            const end = new Date(start); end.setDate(end.getDate()+6);
            const fmt = d => d.toLocaleDateString('en-NZ', {day:'numeric', month:'short'}).toUpperCase();
            
            const labelDiv = document.getElementById('tracker-nav');
            labelDiv.innerHTML = `
                <div class="flex justify-center items-center gap-4">
                    <button id="track-prev" class="p-2 opacity-60 hover:opacity-100"><svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7"></path></svg></button>
                    <div class="text-xs font-bold uppercase w-32 text-center">${fmt(start)} - ${fmt(end)}</div>
                    <button id="track-next" class="p-2 opacity-60 hover:opacity-100"><svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7"></path></svg></button>
                </div>
            `;
            
            // Add listeners to new buttons
            document.getElementById('track-prev').addEventListener('click', () => app.tracker.shift(-1));
            document.getElementById('track-next').addEventListener('click', () => app.tracker.shift(1));

            // Filter
            const weekTxns = app.state.transactions.filter(t => {
                const d = new Date(t.date);
                return d >= start && d <= end;
            }).sort((a,b) => new Date(b.date) - new Date(a.date));

            // Balance
            let totalBalance = app.state.transactions.reduce((acc, t) => acc + (t.type==='income'?t.amount:-t.amount), 0);
            document.getElementById('wallet-balance').innerText = `$${totalBalance.toFixed(2)}`;

            if(weekTxns.length === 0) {
                container.innerHTML = '<div class="text-center opacity-40 mt-10 text-sm">No transactions this week.</div>';
                return;
            }

            weekTxns.forEach(t => {
                const dateStr = new Date(t.date).toLocaleDateString('en-NZ', {day:'2-digit', month:'2-digit'});
                const div = document.createElement('div');
                div.className = "ios-card relative group";
                div.innerHTML = `
                    <div class="p-3 flex justify-between items-center cursor-pointer txn-trigger">
                        <div class="flex items-center gap-3">
                            <span class="text-xs font-mono opacity-50">[${dateStr}]</span>
                            <span class="font-medium text-sm">${t.label}</span>
                        </div>
                        <div class="flex items-center gap-2">
                            <span class="font-bold text-sm ${t.type==='income'?'text-green-500':''}">${t.type==='income'?'+':'-'}$${t.amount.toFixed(2)}</span>
                            <button class="edit-btn opacity-30 hover:opacity-100 px-2">⚙️</button>
                        </div>
                    </div>
                `;
                // Add Edit Listener
                div.querySelector('.edit-btn').addEventListener('click', (e) => {
                    e.stopPropagation();
                    app.tracker.editModal(t.id);
                });
                container.appendChild(div);
            });
        },

        shift: function(dir) {
            app.state.viewDate.setDate(app.state.viewDate.getDate() + (dir*7));
            this.render();
        },

        openModal: function() {
            const modal = document.getElementById('addModal');
            modal.classList.remove('hidden');
            modal.classList.add('flex');
            
            document.getElementById('modal-title').innerText = "Add Transaction";
            document.getElementById('t-id').value = "";
            document.getElementById('t-amount').value = "";
            document.getElementById('t-label').value = "";
            document.getElementById('t-date').valueAsDate = new Date();
            
            document.getElementById('delete-btn').classList.add('hidden');
            const saveBtn = document.getElementById('save-btn');
            saveBtn.classList.remove('col-span-1');
            saveBtn.classList.add('col-span-2');
        },

        editModal: function(id) {
            const t = app.state.transactions.find(x => x.id === parseInt(id));
            if(!t) return;
            
            this.openModal();
            document.getElementById('modal-title').innerText = "Edit Transaction";
            document.getElementById('t-id').value = t.id;
            document.getElementById('t-amount').value = t.amount;
            document.getElementById('t-type').value = t.type;
            document.getElementById('t-date').value = t.date;
            document.getElementById('t-label').value = t.label;
            
            document.getElementById('delete-btn').classList.remove('hidden');
            const saveBtn = document.getElementById('save-btn');
            saveBtn.classList.remove('col-span-2');
            saveBtn.classList.add('col-span-1');
        },

        closeModal: function() { 
            const modal = document.getElementById('addModal');
            modal.classList.add('hidden');
            modal.classList.remove('flex');
        },

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

        bank: function(amountStr) {
            this.openModal();
            document.getElementById('t-amount').value = amountStr;
            document.getElementById('t-type').value = 'income';
            document.getElementById('t-label').value = 'Weekly Pay';
        }
    },

    // --- GRAPH ---
    graph: {
        update: function() {
            const hourlyRate = parseFloat(document.getElementById('hourly').value) || 0;
            const baseBenefit = parseFloat(document.getElementById('base-benefit').value) || 0;
            if (hourlyRate === 0) return;

            const settings = {
                hasHp: document.getElementById('hpToggle').checked,
                hasLoan: document.getElementById('slToggle').checked,
                hasKs: document.getElementById('ksToggle').checked,
                ksRate: parseFloat(document.getElementById('ksPercent').value)
            };

            let labels = [], dataMoney = [], sweetEnd = 0, deadEnd = 0;
            app.state.optDataStore = [];

            // Calculate 0 to 50 hours efficiently
            for(let h=0; h<=50; h++) {
                const gross = hourlyRate * h * (settings.hasHp ? 1.08 : 1);
                
                // Use the Engine!
                const ded = app.engine.calculateDeductions(gross, settings);
                const netPay = gross - ded.total;
                const benefit = app.engine.calculateAbatement(gross, baseBenefit);
                
                const total = netPay + benefit;
                
                labels.push(h);
                dataMoney.push(total);
                
                let zone = 'breakout';
                if(gross <= NZ_CONFIG.BENEFIT_ABATEMENT.FREE_ZONE) { zone = 'sweet'; sweetEnd = h; }
                else if(benefit > 0) { zone = 'dead'; deadEnd = h; }
                
                // Logic for "Symbols" (Quick visual indicators)
                let prev = h===0 ? 0 : app.state.optDataStore[h-1].total;
                let marg = total - prev;
                let sym = '';
                // Sweet Spot Limit
                if(zone==='sweet' && (gross + hourlyRate) > NZ_CONFIG.BENEFIT_ABATEMENT.FREE_ZONE) sym='⚠️'; 
                // Stagnation (earning less than $2/hr effective)
                if(zone==='dead' && marg < 2 && h > 0) sym='🛑'; 
                // Freedom
                if(zone==='breakout' && benefit === 0 && app.state.optDataStore[h-1].benefit > 0) sym='🏁';

                app.state.optDataStore.push({h, total, marg, zone, sym, work: netPay, benefit});
            }

            // Draw Chart
            const ctx = document.getElementById('optChart').getContext('2d');
            if(app.state.chartInstance) app.state.chartInstance.destroy();
            
            const gradient = ctx.createLinearGradient(0,0,0,300);
            gradient.addColorStop(0, 'rgba(0,122,255,0.4)');
            gradient.addColorStop(1, 'rgba(0,122,255,0.05)');

            app.state.chartInstance = new Chart(ctx, {
                type: 'line',
                data: {
                    labels: labels,
                    datasets: [{
                        label: 'Total Income',
                        data: dataMoney,
                        borderColor: '#007AFF',
                        backgroundColor: gradient,
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
                        <span>Ben: $${d.benefit.toFixed(0)}</span>
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
                
                const row = document.createElement('div');
                row.innerHTML = `
                    <div class="opt-row ${bg}">
                        <div>${d.h}</div>
                        <div class="text-center">${d.sym}</div>
                        <div class="text-right">$${d.total.toFixed(0)}</div>
                        <div class="text-right text-xs">+$${d.marg.toFixed(2)}</div>
                        <div class="text-right text-[10px] uppercase opacity-50">${d.zone}</div>
                    </div>
                    <div class="opt-detail">
                        <div class="flex justify-between text-xs"><span>Work Net</span><span>$${d.work.toFixed(2)}</span></div>
                        <div class="flex justify-between text-xs"><span>Benefit</span><span>$${d.benefit.toFixed(2)}</span></div>
                    </div>
                `;
                // Add click listener to the row to toggle details
                row.querySelector('.opt-row').addEventListener('click', function() {
                    this.nextElementSibling.classList.toggle('open');
                });
                
                t.appendChild(row);
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

// Start App
app.init();
