/**
 * VisualizationEngine - Export and visualize protein structures
 *
 * Features:
 * - PDB format export (Protein Data Bank standard)
 * - Confidence heatmap generation
 * - Structure comparison visualization
 * - PyMOL and Mol* compatible output
 */

import { ProteinStructure, Atom, Coordinate } from './types';
import * as fs from 'fs/promises';

export class VisualizationEngine {
  /**
   * Export structure to PDB format
   */
  async exportPDB(structure: ProteinStructure, filepath: string): Promise<void> {
    const lines: string[] = [];

    // Header
    lines.push('HEADER    PROTEIN STRUCTURE PREDICTION');
    lines.push(`TITLE     ${structure.sequenceId}`);
    lines.push(`REMARK   1 PREDICTED BY ${structure.predictedBy}`);
    lines.push(`REMARK   2 CONFIDENCE ${(structure.confidence * 100).toFixed(2)}%`);
    lines.push(`REMARK   3 TIMESTAMP ${new Date(structure.timestamp).toISOString()}`);

    if (structure.energy !== undefined) {
      lines.push(`REMARK   4 ENERGY ${structure.energy.toFixed(2)} kcal/mol`);
    }

    // Atom records
    for (const atom of structure.atoms) {
      const line = this.formatAtomRecord(atom);
      lines.push(line);
    }

    // Footer
    lines.push('END');

    // Write to file
    await fs.writeFile(filepath, lines.join('\n'));
    console.log(`PDB file written to: ${filepath}`);
  }

  /**
   * Format atom record in PDB format
   * Format specification: https://www.wwpdb.org/documentation/file-format-content/format33/sect9.html
   */
  private formatAtomRecord(atom: Atom): string {
    // ATOM record format (fixed-width fields)
    const recordType = 'ATOM  ';
    const atomId = String(atom.atomId).padStart(5);
    const atomName = atom.atomName.padEnd(4);
    const residueName = atom.residueName.padStart(3);
    const chainId = atom.chainId || 'A';
    const residueNumber = String(atom.residueNumber).padStart(4);
    const x = atom.coordinate.x.toFixed(3).padStart(8);
    const y = atom.coordinate.y.toFixed(3).padStart(8);
    const z = atom.coordinate.z.toFixed(3).padStart(8);
    const occupancy = (atom.occupancy || 1.0).toFixed(2).padStart(6);
    const bFactor = (atom.bFactor || 0.0).toFixed(2).padStart(6);
    const element = atom.atomName[0].padStart(12);

    return (
      recordType +
      atomId + ' ' +
      atomName + ' ' +
      residueName + ' ' +
      chainId +
      residueNumber + '    ' +
      x +
      y +
      z +
      occupancy +
      bFactor +
      element
    );
  }

  /**
   * Export structure with confidence heatmap (B-factor column)
   */
  async exportWithConfidence(structure: ProteinStructure, filepath: string): Promise<void> {
    // Use per-residue confidence as B-factor for visualization
    const atomsWithConfidence = structure.atoms.map(atom => ({
      ...atom,
      bFactor: (structure.perResidueConfidence[atom.residueNumber - 1] || 0.5) * 100
    }));

    const structureWithConfidence = {
      ...structure,
      atoms: atomsWithConfidence
    };

    await this.exportPDB(structureWithConfidence, filepath);
    console.log('Confidence values encoded in B-factor column');
  }

  /**
   * Generate PyMOL script for visualization
   */
  async generatePyMOLScript(
    pdbFile: string,
    scriptPath: string,
    options: {
      showConfidence?: boolean;
      showBackbone?: boolean;
      showSurface?: boolean;
    } = {}
  ): Promise<void> {
    const lines: string[] = [];

    // Load structure
    lines.push(`# PyMOL visualization script`);
    lines.push(`load ${pdbFile}`);
    lines.push('');

    // Basic display
    lines.push('# Basic display settings');
    lines.push('bg_color white');
    lines.push('set ray_shadows, 0');
    lines.push('set antialias, 2');
    lines.push('');

    // Color by confidence (B-factor)
    if (options.showConfidence !== false) {
      lines.push('# Color by confidence (B-factor)');
      lines.push('spectrum b, red_white_blue, minimum=50, maximum=100');
      lines.push('');
    }

    // Show backbone
    if (options.showBackbone) {
      lines.push('# Show backbone');
      lines.push('show cartoon');
      lines.push('cartoon tube');
      lines.push('');
    }

    // Show surface
    if (options.showSurface) {
      lines.push('# Show molecular surface');
      lines.push('show surface');
      lines.push('set transparency, 0.3');
      lines.push('');
    }

    // Orient
    lines.push('# Orient and zoom');
    lines.push('orient');
    lines.push('zoom');

    await fs.writeFile(scriptPath, lines.join('\n'));
    console.log(`PyMOL script written to: ${scriptPath}`);
    console.log(`Run with: pymol ${scriptPath}`);
  }

  /**
   * Export comparison between two structures
   */
  async exportComparison(
    structure1: ProteinStructure,
    structure2: ProteinStructure,
    outputDir: string
  ): Promise<void> {
    // Ensure output directory exists
    await fs.mkdir(outputDir, { recursive: true });

    // Export both structures
    await this.exportPDB(structure1, `${outputDir}/structure1.pdb`);
    await this.exportPDB(structure2, `${outputDir}/structure2.pdb`);

    // Calculate per-residue RMSD
    const rmsdPerResidue = this.calculatePerResidueRMSD(structure1, structure2);

    // Export RMSD data
    const rmsdLines = ['# Residue RMSD (Angstroms)', 'Residue\tRMSD'];
    rmsdPerResidue.forEach((rmsd, i) => {
      rmsdLines.push(`${i + 1}\t${rmsd.toFixed(3)}`);
    });
    await fs.writeFile(`${outputDir}/rmsd.txt`, rmsdLines.join('\n'));

    // Generate comparison script
    await this.generateComparisonScript(outputDir);

    console.log(`Comparison files written to: ${outputDir}`);
  }

  /**
   * Calculate per-residue RMSD
   */
  private calculatePerResidueRMSD(
    structure1: ProteinStructure,
    structure2: ProteinStructure
  ): number[] {
    const maxResidue = Math.max(
      ...structure1.atoms.map(a => a.residueNumber),
      ...structure2.atoms.map(a => a.residueNumber)
    );

    const rmsdPerResidue: number[] = [];

    for (let resNum = 1; resNum <= maxResidue; resNum++) {
      const atoms1 = structure1.atoms.filter(a => a.residueNumber === resNum && a.atomName === 'CA');
      const atoms2 = structure2.atoms.filter(a => a.residueNumber === resNum && a.atomName === 'CA');

      if (atoms1.length > 0 && atoms2.length > 0) {
        const rmsd = this.calculateDistance(atoms1[0].coordinate, atoms2[0].coordinate);
        rmsdPerResidue.push(rmsd);
      } else {
        rmsdPerResidue.push(0);
      }
    }

    return rmsdPerResidue;
  }

  /**
   * Generate PyMOL comparison script
   */
  private async generateComparisonScript(outputDir: string): Promise<void> {
    const lines = [
      '# PyMOL structure comparison script',
      'load structure1.pdb',
      'load structure2.pdb',
      '',
      '# Color structures differently',
      'color blue, structure1',
      'color red, structure2',
      '',
      '# Align structures',
      'align structure1, structure2',
      '',
      '# Show both as cartoon',
      'show cartoon',
      '',
      '# Show RMSD per residue',
      'spectrum b, red_white_blue',
      '',
      '# Orient',
      'orient',
      'zoom'
    ];

    await fs.writeFile(`${outputDir}/compare.pml`, lines.join('\n'));
  }

  /**
   * Calculate distance between coordinates
   */
  private calculateDistance(coord1: Coordinate, coord2: Coordinate): number {
    const dx = coord1.x - coord2.x;
    const dy = coord1.y - coord2.y;
    const dz = coord1.z - coord2.z;
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
  }

  /**
   * Generate HTML visualization report
   */
  async generateReport(
    structure: ProteinStructure,
    validation: any,
    outputPath: string
  ): Promise<void> {
    const html = `
<!DOCTYPE html>
<html>
<head>
  <title>Protein Structure Report - ${structure.sequenceId}</title>
  <style>
    body { font-family: Arial, sans-serif; margin: 40px; }
    h1 { color: #333; }
    .metric { margin: 20px 0; padding: 15px; background: #f5f5f5; border-radius: 5px; }
    .metric-label { font-weight: bold; color: #555; }
    .metric-value { font-size: 1.2em; color: #007bff; }
    .valid { color: green; }
    .invalid { color: red; }
    table { border-collapse: collapse; width: 100%; margin: 20px 0; }
    th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
    th { background: #007bff; color: white; }
  </style>
</head>
<body>
  <h1>Protein Structure Prediction Report</h1>

  <div class="metric">
    <div class="metric-label">Sequence ID</div>
    <div class="metric-value">${structure.sequenceId}</div>
  </div>

  <div class="metric">
    <div class="metric-label">Predicted By</div>
    <div class="metric-value">${structure.predictedBy}</div>
  </div>

  <div class="metric">
    <div class="metric-label">Confidence</div>
    <div class="metric-value">${(structure.confidence * 100).toFixed(2)}%</div>
  </div>

  <div class="metric">
    <div class="metric-label">Number of Atoms</div>
    <div class="metric-value">${structure.atoms.length}</div>
  </div>

  <div class="metric">
    <div class="metric-label">Validation Status</div>
    <div class="metric-value ${validation.isValid ? 'valid' : 'invalid'}">
      ${validation.isValid ? 'VALID' : 'INVALID'}
    </div>
  </div>

  ${validation.energy !== undefined ? `
  <div class="metric">
    <div class="metric-label">Estimated Energy</div>
    <div class="metric-value">${validation.energy.toFixed(2)} kcal/mol</div>
  </div>
  ` : ''}

  <h2>Validation Details</h2>
  <table>
    <tr>
      <th>Metric</th>
      <th>Value</th>
    </tr>
    <tr>
      <td>Bond Violations</td>
      <td>${validation.bondViolations}</td>
    </tr>
    <tr>
      <td>Angle Violations</td>
      <td>${validation.angleViolations}</td>
    </tr>
    <tr>
      <td>Atomic Clashes</td>
      <td>${validation.clashes}</td>
    </tr>
  </table>

  ${validation.warnings.length > 0 ? `
  <h2>Warnings</h2>
  <ul>
    ${validation.warnings.map((w: string) => `<li>${w}</li>`).join('\n    ')}
  </ul>
  ` : ''}

  ${validation.errors.length > 0 ? `
  <h2>Errors</h2>
  <ul>
    ${validation.errors.map((e: string) => `<li>${e}</li>`).join('\n    ')}
  </ul>
  ` : ''}

  <p><em>Report generated: ${new Date().toISOString()}</em></p>
</body>
</html>
`;

    await fs.writeFile(outputPath, html);
    console.log(`HTML report written to: ${outputPath}`);
  }
}
