export const NZ_CONFIG = {
    TAX_BRACKETS: [
        { limit: 15600, rate: 0.105 },
        { limit: 53500, rate: 0.175 },
        { limit: 78100, rate: 0.30 },
        { limit: 180000, rate: 0.33 },
        { limit: Infinity, rate: 0.39 }
    ],
    ACC: {
        RATE: 0.016,
        CAP: 142283
    },
    STUDENT_LOAN: {
        THRESHOLD_WEEKLY: 465,
        RATE: 0.12
    },
    BENEFIT_ABATEMENT: {
        FREE_ZONE: 160,
        REDUCTION_RATE: 0.70
    }
};
