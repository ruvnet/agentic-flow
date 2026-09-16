/**
 * ProteinSequenceParser - Parse and validate FASTA format protein sequences
 *
 * Handles:
 * - FASTA format parsing
 * - Amino acid sequence validation
 * - Multi-chain complex parsing
 * - Metadata extraction
 */

import { ProteinSequence, Chain } from './types';

export class ProteinSequenceParser {
  // Standard 20 amino acids
  private static readonly VALID_AMINO_ACIDS = new Set([
    'A', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'K', 'L',
    'M', 'N', 'P', 'Q', 'R', 'S', 'T', 'V', 'W', 'Y'
  ]);

  /**
   * Parse FASTA format file
   * Format:
   * >sp|P69905|HBA_HUMAN Hemoglobin subunit alpha OS=Homo sapiens
   * MVLSPADKTNVKAAWGKVGAHAGEYGAEALERMFLSFPTTKTYFPHFDLSHGSAQVKGHG
   * KKVADALTNAVAHVDDMPNALSALSDLHAHKLRVDPVNFKLLSHCLLVTLAAHLPAEFTP
   */
  parseFasta(fastaContent: string): ProteinSequence[] {
    const sequences: ProteinSequence[] = [];
    const lines = fastaContent.split('\n').map(line => line.trim());

    let currentSequence: Partial<ProteinSequence> | null = null;
    let sequenceLines: string[] = [];

    for (const line of lines) {
      if (line.startsWith('>')) {
        // Save previous sequence
        if (currentSequence && sequenceLines.length > 0) {
          currentSequence.sequence = sequenceLines.join('').toUpperCase();
          this.validateSequence(currentSequence.sequence);
          sequences.push(currentSequence as ProteinSequence);
        }

        // Parse header
        const metadata = this.parseHeader(line);
        currentSequence = {
          id: metadata.id,
          sequence: '',
          organism: metadata.organism,
          function: metadata.function,
          metadata
        };
        sequenceLines = [];
      } else if (line && currentSequence) {
        // Accumulate sequence lines
        sequenceLines.push(line.replace(/\s/g, ''));
      }
    }

    // Save last sequence
    if (currentSequence && sequenceLines.length > 0) {
      currentSequence.sequence = sequenceLines.join('').toUpperCase();
      this.validateSequence(currentSequence.sequence);
      sequences.push(currentSequence as ProteinSequence);
    }

    return sequences;
  }

  /**
   * Parse FASTA header
   * Example: >sp|P69905|HBA_HUMAN Hemoglobin subunit alpha OS=Homo sapiens GN=HBA1
   */
  private parseHeader(header: string): Record<string, any> {
    const metadata: Record<string, any> = {};

    // Remove leading >
    const cleaned = header.substring(1);

    // Extract ID (first token)
    const tokens = cleaned.split(/\s+/);
    if (tokens[0].includes('|')) {
      const parts = tokens[0].split('|');
      metadata.database = parts[0]; // sp, tr, etc.
      metadata.accession = parts[1];
      metadata.id = parts[2] || parts[1];
    } else {
      metadata.id = tokens[0];
    }

    // Extract description
    const description = tokens.slice(1).join(' ');
    metadata.description = description;

    // Extract organism (OS=...)
    const osMatch = description.match(/OS=([^=]+?)(?:\s+[A-Z]{2}=|$)/);
    if (osMatch) {
      metadata.organism = osMatch[1].trim();
    }

    // Extract gene name (GN=...)
    const gnMatch = description.match(/GN=([^\s]+)/);
    if (gnMatch) {
      metadata.geneName = gnMatch[1];
    }

    // Extract function (if present before OS=)
    const funcMatch = description.match(/^([^O][^S][^=]+?)(?:\s+OS=)/);
    if (funcMatch) {
      metadata.function = funcMatch[1].trim();
    }

    return metadata;
  }

  /**
   * Validate amino acid sequence
   */
  private validateSequence(sequence: string): void {
    if (!sequence || sequence.length === 0) {
      throw new Error('Empty sequence');
    }

    for (let i = 0; i < sequence.length; i++) {
      const aa = sequence[i];
      if (!ProteinSequenceParser.VALID_AMINO_ACIDS.has(aa)) {
        throw new Error(
          `Invalid amino acid '${aa}' at position ${i + 1}. ` +
          `Valid amino acids: ${Array.from(ProteinSequenceParser.VALID_AMINO_ACIDS).join(', ')}`
        );
      }
    }

    // Reasonable length check (1-10000 residues)
    if (sequence.length > 10000) {
      throw new Error(`Sequence too long (${sequence.length} residues). Maximum 10,000 supported.`);
    }
  }

  /**
   * Create simple sequence from string
   */
  createSequence(id: string, sequence: string): ProteinSequence {
    const cleaned = sequence.toUpperCase().replace(/\s/g, '');
    this.validateSequence(cleaned);

    return {
      id,
      sequence: cleaned,
      metadata: { length: cleaned.length }
    };
  }

  /**
   * Split multi-chain complex
   */
  splitChains(sequence: string, delimiter: string = '/'): Chain[] {
    const chains = sequence.split(delimiter);
    return chains.map((chain, i) => ({
      chainId: String.fromCharCode(65 + i), // A, B, C, ...
      sequence: chain.trim(),
      length: chain.length
    }));
  }

  /**
   * Calculate sequence statistics
   */
  getStatistics(sequence: string): Record<string, any> {
    const counts: Record<string, number> = {};

    for (const aa of sequence) {
      counts[aa] = (counts[aa] || 0) + 1;
    }

    const length = sequence.length;
    const composition: Record<string, number> = {};

    for (const [aa, count] of Object.entries(counts)) {
      composition[aa] = count / length;
    }

    // Calculate properties
    const hydrophobic = ['A', 'V', 'I', 'L', 'M', 'F', 'W', 'P'];
    const charged = ['D', 'E', 'K', 'R', 'H'];
    const polar = ['S', 'T', 'N', 'Q', 'C', 'Y'];

    const hydrophobicCount = hydrophobic.reduce((sum, aa) => sum + (counts[aa] || 0), 0);
    const chargedCount = charged.reduce((sum, aa) => sum + (counts[aa] || 0), 0);
    const polarCount = polar.reduce((sum, aa) => sum + (counts[aa] || 0), 0);

    return {
      length,
      composition,
      hydrophobicFraction: hydrophobicCount / length,
      chargedFraction: chargedCount / length,
      polarFraction: polarCount / length,
      molecularWeight: this.calculateMolecularWeight(sequence),
      isoelectricPoint: this.estimateIsoelectricPoint(counts, length)
    };
  }

  /**
   * Estimate molecular weight (Da)
   */
  private calculateMolecularWeight(sequence: string): number {
    const weights: Record<string, number> = {
      'A': 89.1, 'C': 121.2, 'D': 133.1, 'E': 147.1, 'F': 165.2,
      'G': 75.1, 'H': 155.2, 'I': 131.2, 'K': 146.2, 'L': 131.2,
      'M': 149.2, 'N': 132.1, 'P': 115.1, 'Q': 146.2, 'R': 174.2,
      'S': 105.1, 'T': 119.1, 'V': 117.1, 'W': 204.2, 'Y': 181.2
    };

    let weight = 0;
    for (const aa of sequence) {
      weight += weights[aa] || 0;
    }

    // Subtract water molecules (n-1 peptide bonds)
    weight -= (sequence.length - 1) * 18.0;

    return weight;
  }

  /**
   * Estimate isoelectric point (pI)
   */
  private estimateIsoelectricPoint(counts: Record<string, number>, length: number): number {
    // Simplified calculation
    const positive = (counts['K'] || 0) + (counts['R'] || 0) + (counts['H'] || 0) * 0.5;
    const negative = (counts['D'] || 0) + (counts['E'] || 0);

    const netCharge = positive - negative;

    // Rough estimate: pI ≈ 7 + (netCharge / length) * 10
    return Math.max(3, Math.min(11, 7 + (netCharge / length) * 10));
  }
}
