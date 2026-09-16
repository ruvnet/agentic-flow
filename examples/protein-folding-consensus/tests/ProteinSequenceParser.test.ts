/**
 * Tests for ProteinSequenceParser
 */

import { ProteinSequenceParser } from '../src/ProteinSequenceParser';

describe('ProteinSequenceParser', () => {
  let parser: ProteinSequenceParser;

  beforeEach(() => {
    parser = new ProteinSequenceParser();
  });

  describe('parseFasta', () => {
    it('should parse simple FASTA sequence', () => {
      const fasta = `>test_protein
MKVLWAALLVTFLAGCQAKV`;

      const sequences = parser.parseFasta(fasta);

      expect(sequences).toHaveLength(1);
      expect(sequences[0].id).toBe('test_protein');
      expect(sequences[0].sequence).toBe('MKVLWAALLVTFLAGCQAKV');
    });

    it('should parse UniProt format FASTA', () => {
      const fasta = `>sp|P69905|HBA_HUMAN Hemoglobin subunit alpha OS=Homo sapiens GN=HBA1
MVLSPADKTNVKAAWGKVGAHAGEYGAEALERMFLSFPTTKTYFPHFDLSHGSAQVKGHG
KKVADALTNAVAHVDDMPNALSALSDLHAHKLRVDPVNFKLLSHCLLVTLAAHLPAEFTP
AVHASLDKFLASVSTVLTSKYR`;

      const sequences = parser.parseFasta(fasta);

      expect(sequences).toHaveLength(1);
      expect(sequences[0].id).toBe('HBA_HUMAN');
      expect(sequences[0].organism).toBe('Homo sapiens');
      expect(sequences[0].metadata?.geneName).toBe('HBA1');
      expect(sequences[0].sequence.length).toBeGreaterThan(100);
    });

    it('should parse multiple sequences', () => {
      const fasta = `>protein1
MKVLW
>protein2
ACDEF`;

      const sequences = parser.parseFasta(fasta);

      expect(sequences).toHaveLength(2);
      expect(sequences[0].id).toBe('protein1');
      expect(sequences[0].sequence).toBe('MKVLW');
      expect(sequences[1].id).toBe('protein2');
      expect(sequences[1].sequence).toBe('ACDEF');
    });

    it('should handle multi-line sequences', () => {
      const fasta = `>test
MKVLWAALLVTFLAGCQAKV
EDEDTIDVFQQQTGG`;

      const sequences = parser.parseFasta(fasta);

      expect(sequences).toHaveLength(1);
      expect(sequences[0].sequence).toBe('MKVLWAALLVTFLAGCQAKVEDTIDVFQQQTGG');
    });

    it('should throw on invalid amino acid', () => {
      const fasta = `>test
MKVLXW`; // X is not a standard amino acid

      expect(() => parser.parseFasta(fasta)).toThrow('Invalid amino acid');
    });

    it('should throw on empty sequence', () => {
      const fasta = `>test
`;

      expect(() => parser.parseFasta(fasta)).toThrow('Empty sequence');
    });
  });

  describe('createSequence', () => {
    it('should create sequence from string', () => {
      const sequence = parser.createSequence('test', 'MKVLW');

      expect(sequence.id).toBe('test');
      expect(sequence.sequence).toBe('MKVLW');
      expect(sequence.metadata?.length).toBe(5);
    });

    it('should handle lowercase and whitespace', () => {
      const sequence = parser.createSequence('test', 'mkv lw');

      expect(sequence.sequence).toBe('MKVLW');
    });
  });

  describe('getStatistics', () => {
    it('should calculate composition', () => {
      const stats = parser.getStatistics('AAACCCGGG');

      expect(stats.length).toBe(9);
      expect(stats.composition['A']).toBeCloseTo(3/9);
      expect(stats.composition['C']).toBeCloseTo(3/9);
      expect(stats.composition['G']).toBeCloseTo(3/9);
    });

    it('should calculate hydrophobic fraction', () => {
      // AVILMFWP are hydrophobic
      const stats = parser.getStatistics('AVILMFWP');

      expect(stats.hydrophobicFraction).toBe(1.0);
    });

    it('should calculate charged fraction', () => {
      // DEKRH are charged
      const stats = parser.getStatistics('DEKRH');

      expect(stats.chargedFraction).toBe(1.0);
    });

    it('should calculate molecular weight', () => {
      // Simple dipeptide: Ala-Gly
      const stats = parser.getStatistics('AG');

      // Ala (89.1) + Gly (75.1) - H2O (18.0) = 146.2 Da
      expect(stats.molecularWeight).toBeCloseTo(146.2, 1);
    });

    it('should estimate isoelectric point', () => {
      // Lysine-rich (basic) should have high pI
      const statsBasic = parser.getStatistics('KKKK');
      expect(statsBasic.isoelectricPoint).toBeGreaterThan(7);

      // Aspartate-rich (acidic) should have low pI
      const statsAcidic = parser.getStatistics('DDDD');
      expect(statsAcidic.isoelectricPoint).toBeLessThan(7);
    });
  });

  describe('splitChains', () => {
    it('should split multi-chain sequence', () => {
      const chains = parser.splitChains('MKVLW/ACDEF', '/');

      expect(chains).toHaveLength(2);
      expect(chains[0].chainId).toBe('A');
      expect(chains[0].sequence).toBe('MKVLW');
      expect(chains[1].chainId).toBe('B');
      expect(chains[1].sequence).toBe('ACDEF');
    });
  });
});
