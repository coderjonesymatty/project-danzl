import { NZ_CONFIG } from './config.js';

export function calculatePaye(annualGross) {
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
    return tax;
}

export function calculateDeductions(weeklyGross, settings) {
    const annualGross = weeklyGross * 52;

    const annualTax = calculatePaye(annualGross);
    const weeklyPaye = annualTax / 52;

    const liableEarnings = Math.min(annualGross, NZ_CONFIG.ACC.CAP);
    const weeklyAcc = (liableEarnings * NZ_CONFIG.ACC.RATE) / 52;

    let weeklySl = 0;
    if (settings.hasLoan && weeklyGross > NZ_CONFIG.STUDENT_LOAN.THRESHOLD_WEEKLY) {
        weeklySl = (weeklyGross - NZ_CONFIG.STUDENT_LOAN.THRESHOLD_WEEKLY) * NZ_CONFIG.STUDENT_LOAN.RATE;
    }

    const weeklyKs = settings.hasKs ? weeklyGross * settings.ksRate : 0;

    return {
        paye: weeklyPaye,
        acc: weeklyAcc,
        sl: weeklySl,
        ks: weeklyKs,
        total: weeklyPaye + weeklyAcc + weeklySl + weeklyKs
    };
}

export function calculateAbatement(weeklyGross, baseBenefit) {
    if (weeklyGross <= NZ_CONFIG.BENEFIT_ABATEMENT.FREE_ZONE) return baseBenefit;

    const reduction = (weeklyGross - NZ_CONFIG.BENEFIT_ABATEMENT.FREE_ZONE) * NZ_CONFIG.BENEFIT_ABATEMENT.REDUCTION_RATE;
    return Math.max(0, baseBenefit - reduction);
}
