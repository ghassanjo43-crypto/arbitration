/** Arbitration practice fields supported by the panel. */
export enum ArbitrationField {
  CONSTRUCTION_ENGINEERING = 'CONSTRUCTION_ENGINEERING',
  ENERGY = 'ENERGY',
  RENEWABLE_ENERGY = 'RENEWABLE_ENERGY',
  OIL_AND_GAS = 'OIL_AND_GAS',
  CORPORATE_COMMERCIAL = 'CORPORATE_COMMERCIAL',
  BANKING_FINANCE = 'BANKING_FINANCE',
  INTERNATIONAL_TRADE = 'INTERNATIONAL_TRADE',
  INVESTMENT = 'INVESTMENT',
  TECHNOLOGY = 'TECHNOLOGY',
  SOFTWARE = 'SOFTWARE',
  ARTIFICIAL_INTELLIGENCE = 'ARTIFICIAL_INTELLIGENCE',
  DATA_CYBERSECURITY = 'DATA_CYBERSECURITY',
  INTELLECTUAL_PROPERTY = 'INTELLECTUAL_PROPERTY',
  MARITIME = 'MARITIME',
  SHIPPING = 'SHIPPING',
  TRANSPORT = 'TRANSPORT',
  REAL_ESTATE = 'REAL_ESTATE',
  INSURANCE = 'INSURANCE',
  EMPLOYMENT = 'EMPLOYMENT',
  SPORTS = 'SPORTS',
  ENTERTAINMENT = 'ENTERTAINMENT',
  HEALTHCARE = 'HEALTHCARE',
  LIFE_SCIENCES = 'LIFE_SCIENCES',
  TELECOMMUNICATIONS = 'TELECOMMUNICATIONS',
  JOINT_VENTURES = 'JOINT_VENTURES',
  SHAREHOLDER_DISPUTES = 'SHAREHOLDER_DISPUTES',
  AGENCY_DISTRIBUTION = 'AGENCY_DISTRIBUTION',
  SUPPLY_AGREEMENTS = 'SUPPLY_AGREEMENTS',
  GOVERNMENT_CONTRACTS = 'GOVERNMENT_CONTRACTS',
}

export const ARBITRATION_FIELD_LABELS: Record<ArbitrationField, string> = {
  [ArbitrationField.CONSTRUCTION_ENGINEERING]: 'Construction & Engineering',
  [ArbitrationField.ENERGY]: 'Energy',
  [ArbitrationField.RENEWABLE_ENERGY]: 'Renewable Energy',
  [ArbitrationField.OIL_AND_GAS]: 'Oil & Gas',
  [ArbitrationField.CORPORATE_COMMERCIAL]: 'Corporate & Commercial',
  [ArbitrationField.BANKING_FINANCE]: 'Banking & Finance',
  [ArbitrationField.INTERNATIONAL_TRADE]: 'International Trade',
  [ArbitrationField.INVESTMENT]: 'Investment Disputes',
  [ArbitrationField.TECHNOLOGY]: 'Technology',
  [ArbitrationField.SOFTWARE]: 'Software',
  [ArbitrationField.ARTIFICIAL_INTELLIGENCE]: 'Artificial Intelligence',
  [ArbitrationField.DATA_CYBERSECURITY]: 'Data & Cybersecurity',
  [ArbitrationField.INTELLECTUAL_PROPERTY]: 'Intellectual Property',
  [ArbitrationField.MARITIME]: 'Maritime',
  [ArbitrationField.SHIPPING]: 'Shipping',
  [ArbitrationField.TRANSPORT]: 'Transport',
  [ArbitrationField.REAL_ESTATE]: 'Real Estate',
  [ArbitrationField.INSURANCE]: 'Insurance',
  [ArbitrationField.EMPLOYMENT]: 'Employment (where arbitrable)',
  [ArbitrationField.SPORTS]: 'Sports',
  [ArbitrationField.ENTERTAINMENT]: 'Entertainment',
  [ArbitrationField.HEALTHCARE]: 'Healthcare',
  [ArbitrationField.LIFE_SCIENCES]: 'Life Sciences',
  [ArbitrationField.TELECOMMUNICATIONS]: 'Telecommunications',
  [ArbitrationField.JOINT_VENTURES]: 'Joint Ventures',
  [ArbitrationField.SHAREHOLDER_DISPUTES]: 'Shareholder Disputes',
  [ArbitrationField.AGENCY_DISTRIBUTION]: 'Agency & Distribution',
  [ArbitrationField.SUPPLY_AGREEMENTS]: 'Supply Agreements',
  [ArbitrationField.GOVERNMENT_CONTRACTS]: 'Government Contracts (where permissible)',
};

export enum AvailabilityStatus {
  AVAILABLE = 'AVAILABLE',
  LIMITED = 'LIMITED',
  UNAVAILABLE = 'UNAVAILABLE',
}

export enum VerificationStatus {
  UNVERIFIED = 'UNVERIFIED',
  PENDING = 'PENDING',
  VERIFIED = 'VERIFIED',
  REJECTED = 'REJECTED',
}

export enum FeeBand {
  STANDARD = 'STANDARD',
  SENIOR = 'SENIOR',
  PREMIUM = 'PREMIUM',
}

export enum Language {
  EN = 'en',
  AR = 'ar',
}
