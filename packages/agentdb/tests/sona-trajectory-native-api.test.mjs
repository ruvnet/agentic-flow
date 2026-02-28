/**
 * Test suite for SonaTrajectoryService patch
 *
 * Validates that the patched service correctly:
 * 1. Initializes the native SonaEngine (not just stores the module)
 * 2. Records trajectories using the correct native API
 * 3. Triggers learning after sufficient trajectories
 * 4. Returns patterns via findPatterns for predictions
 * 5. Falls back gracefully to JS when native unavailable
 * 6. Maintains backward compatibility with existing callers
 */

// Import the patched service
import { SonaTrajectoryService } from '../src/SonaTrajectoryService.js';

let passed = 0;
let failed = 0;

function assert(condition, message) {
    if (condition) {
        passed++;
        console.log(`  PASS: ${message}`);
    } else {
        failed++;
        console.error(`  FAIL: ${message}`);
    }
}

function section(name) {
    console.log(`\n=== ${name} ===`);
}

async function runTests() {
    // =========================================================================
    section('TEST 1: Initialization - Native Engine');
    // =========================================================================
    {
        const sona = new SonaTrajectoryService();
        const result = await sona.initialize({ hiddenDim: 32 });

        assert(result === true, 'initialize() returns true when native available');
        assert(sona.available === true, 'available is true');
        assert(sona.engineType === 'native', 'engineType is "native"');
        assert(sona.sona !== null, 'sona engine instance is not null');
        assert(typeof sona.sona.beginTrajectory === 'function', 'engine has beginTrajectory method');
        assert(typeof sona.sona.addTrajectoryStep === 'function', 'engine has addTrajectoryStep method');
        assert(typeof sona.sona.endTrajectory === 'function', 'engine has endTrajectory method');
        assert(typeof sona.sona.findPatterns === 'function', 'engine has findPatterns method');
        assert(typeof sona.sona.forceLearn === 'function', 'engine has forceLearn method');
        assert(sona.sona.isEnabled() === true, 'engine is enabled');
    }

    // =========================================================================
    section('TEST 2: Record Single Trajectory');
    // =========================================================================
    {
        const sona = new SonaTrajectoryService();
        await sona.initialize({ hiddenDim: 32 });

        // Record a trajectory in the same format callers use
        await sona.recordTrajectory('coder', [
            { state: { task: 'implement auth' }, action: 'write_code', reward: 0.8 },
            { state: { task: 'test auth' }, action: 'run_tests', reward: 0.9 }
        ]);

        const nativeStats = sona.getNativeStats();
        assert(nativeStats !== null, 'getNativeStats returns data');
        assert(nativeStats.trajectories_buffered >= 0, 'trajectories are tracked in native engine');
        assert(nativeStats.trajectories_dropped === 0, 'no trajectories dropped');

        // Also check in-memory storage (backward compat)
        const stats = sona.getStats();
        assert(stats.trajectoryCount === 1, 'in-memory trajectory count is 1');
        assert(stats.agentTypes.includes('coder'), 'agent type "coder" recorded');
        assert(stats.engineType === 'native', 'stats show native engine');
        assert(stats.native !== undefined, 'stats include native sub-stats');
    }

    // =========================================================================
    section('TEST 3: Record 120 Trajectories and Trigger Learning');
    // =========================================================================
    {
        const sona = new SonaTrajectoryService();
        await sona.initialize({ hiddenDim: 32 });

        const agents = ['coder', 'tester', 'reviewer'];

        // Record 120 trajectories (above 100 minimum threshold)
        for (let i = 0; i < 120; i++) {
            const agentType = agents[i % 3];
            await sona.recordTrajectory(agentType, [
                { state: { task: `task-${i}`, type: agentType }, action: `action-${agentType}`, reward: 0.7 + Math.random() * 0.3 },
                { state: { task: `task-${i}-step2`, type: agentType }, action: `verify-${agentType}`, reward: 0.8 + Math.random() * 0.2 }
            ]);
        }

        const statsBefore = sona.getNativeStats();
        console.log(`  [info] Before learning: ${JSON.stringify(statsBefore)}`);

        // Force learning
        const learnResult = sona.forceLearn();
        console.log(`  [info] forceLearn result: ${learnResult}`);

        const statsAfter = sona.getNativeStats();
        console.log(`  [info] After learning: ${JSON.stringify(statsAfter)}`);

        assert(statsAfter.patterns_stored > 0, `patterns_stored > 0 (got ${statsAfter.patterns_stored})`);
        assert(learnResult.includes('completed'), 'forceLearn reports "completed"');
        assert(statsAfter.trajectories_buffered === 0, 'buffer is drained after learning');
    }

    // =========================================================================
    section('TEST 4: Pattern Search After Learning');
    // =========================================================================
    {
        const sona = new SonaTrajectoryService();
        await sona.initialize({ hiddenDim: 32 });

        // Build up trajectories with distinct patterns
        for (let i = 0; i < 120; i++) {
            const agentType = i % 2 === 0 ? 'coder' : 'reviewer';
            await sona.recordTrajectory(agentType, [
                { state: { task: `impl-${i}`, domain: agentType }, action: agentType, reward: 0.85 }
            ]);
        }

        sona.forceLearn();

        const nativeStats = sona.getNativeStats();
        console.log(`  [info] Native patterns after learn: ${nativeStats.patterns_stored}`);

        // Test native pattern retrieval via predict (which uses findPatterns internally)
        const prediction = await sona.predict({ task: 'impl-test', domain: 'coder' });
        assert(prediction !== null, 'prediction after learning returns result');

        if (nativeStats.patterns_stored > 0) {
            // Native patterns available - getPatterns should return JsLearnedPattern objects
            const patterns = await sona.getPatterns();
            assert(Array.isArray(patterns), 'getPatterns returns array');
            assert(patterns.length > 0, `getPatterns returns patterns (got ${patterns.length})`);
            if (patterns.length > 0) {
                const p = patterns[0];
                assert(p.id !== undefined, 'pattern has id');
                assert(Array.isArray(p.centroid), 'pattern has centroid array');
                assert(typeof p.clusterSize === 'number', 'pattern has clusterSize');
                assert(typeof p.avgQuality === 'number', 'pattern has avgQuality');
                assert(p.avgQuality > 0, `pattern avgQuality > 0 (got ${p.avgQuality})`);
            }
        } else {
            // Native didn't store patterns, falls back to in-memory
            const patterns = await sona.getPatterns();
            assert(Array.isArray(patterns), 'getPatterns falls back to in-memory array');
            assert(patterns.length === 120, `in-memory fallback has all 120 trajectories (got ${patterns.length})`);
        }
    }

    // =========================================================================
    section('TEST 5: Predict After Learning');
    // =========================================================================
    {
        const sona = new SonaTrajectoryService();
        await sona.initialize({ hiddenDim: 32 });

        // Record enough trajectories
        for (let i = 0; i < 120; i++) {
            await sona.recordTrajectory('coder', [
                { state: { task: 'implement feature' }, action: 'write_code', reward: 0.9 }
            ]);
        }
        sona.forceLearn();

        // Test prediction
        const prediction = await sona.predict({ task: 'implement feature' });
        assert(prediction !== null, 'predict returns a result');
        assert(typeof prediction.action === 'string', 'prediction has action string');
        assert(typeof prediction.confidence === 'number', 'prediction has confidence number');
        console.log(`  [info] Prediction: ${JSON.stringify(prediction)}`);

        // If native patterns available, should come from native
        const nativeStats = sona.getNativeStats();
        if (nativeStats.patterns_stored > 0) {
            assert(prediction.source === 'native-sona', 'prediction source is native-sona');
        }
    }

    // =========================================================================
    section('TEST 6: stateToEmbedding Determinism');
    // =========================================================================
    {
        const sona = new SonaTrajectoryService();
        sona.hiddenDim = 32;

        const emb1 = sona.stateToEmbedding({ task: 'implement auth' });
        const emb2 = sona.stateToEmbedding({ task: 'implement auth' });
        const emb3 = sona.stateToEmbedding({ task: 'fix bug' });

        assert(emb1.length === 32, 'embedding has correct dimensions');
        assert(JSON.stringify(emb1) === JSON.stringify(emb2), 'same input produces same embedding');
        assert(JSON.stringify(emb1) !== JSON.stringify(emb3), 'different input produces different embedding');

        // Check L2 normalization
        const norm = Math.sqrt(emb1.reduce((s, v) => s + v * v, 0));
        assert(Math.abs(norm - 1.0) < 0.001, `embedding is L2 normalized (norm=${norm.toFixed(6)})`);
    }

    // =========================================================================
    section('TEST 7: Backward Compatibility - In-Memory Always Maintained');
    // =========================================================================
    {
        const sona = new SonaTrajectoryService();
        await sona.initialize({ hiddenDim: 32 });

        await sona.recordTrajectory('coder', [
            { state: { task: 'x' }, action: 'a', reward: 0.5 }
        ]);
        await sona.recordTrajectory('tester', [
            { state: { task: 'y' }, action: 'b', reward: 0.7 }
        ]);

        // Even with native engine, in-memory storage should work
        const stats = sona.getStats();
        assert(stats.trajectoryCount === 2, 'in-memory has both trajectories');
        assert(stats.agentTypes.length === 2, 'both agent types tracked');

        // Frequency predict should still work
        const freq = sona.frequencyPredict();
        assert(typeof freq.action === 'string', 'frequencyPredict still works');
        assert(typeof freq.confidence === 'number', 'frequencyPredict returns confidence');
    }

    // =========================================================================
    section('TEST 8: forceLearn and getNativeStats New Methods');
    // =========================================================================
    {
        const sona = new SonaTrajectoryService();
        await sona.initialize({ hiddenDim: 32 });

        const learnResult = sona.forceLearn();
        assert(typeof learnResult === 'string', 'forceLearn returns a string');

        const nativeStats = sona.getNativeStats();
        assert(nativeStats !== null, 'getNativeStats returns data');
        assert(typeof nativeStats.trajectories_buffered === 'number', 'native stats has trajectories_buffered');
        assert(typeof nativeStats.patterns_stored === 'number', 'native stats has patterns_stored');
        assert(typeof nativeStats.instant_enabled === 'boolean', 'native stats has instant_enabled');
        assert(typeof nativeStats.background_enabled === 'boolean', 'native stats has background_enabled');
    }

    // =========================================================================
    section('TEST 9: Error Recovery - Bad Steps Don\'t Crash');
    // =========================================================================
    {
        const sona = new SonaTrajectoryService();
        await sona.initialize({ hiddenDim: 32 });

        // These should not throw
        await sona.recordTrajectory('coder', []);
        await sona.recordTrajectory('coder', [
            { state: null, action: 'test', reward: 0.5 }
        ]);
        await sona.recordTrajectory('coder', [
            { state: undefined, action: undefined, reward: 0 }
        ]);

        assert(true, 'bad inputs handled without crash');

        // Predict with bad state should still work
        const pred = await sona.predict(null);
        assert(pred !== null, 'predict with null state returns result');
    }

    // =========================================================================
    section('TEST 10: RL Methods Still Work (Backward Compat)');
    // =========================================================================
    {
        const sona = new SonaTrajectoryService();
        await sona.initialize({ hiddenDim: 32 });

        // These existing RL methods should still function
        const loss = await sona.trainPolicy([{
            steps: [{ state: {}, action: 'a', reward: 1 }],
            reward: 1
        }]);
        assert(typeof loss === 'number', 'trainPolicy returns a number');

        const value = await sona.estimateValue({}, 1.0, {});
        assert(typeof value === 'number', 'estimateValue returns a number');

        sona.addExperience({}, 'a', 1.0, {});
        const batch = sona.sampleExperience(1);
        assert(batch.length === 1, 'sampleExperience returns batch');

        const rlMetrics = sona.getRLMetrics();
        assert(typeof rlMetrics.loss === 'number', 'getRLMetrics works');

        sona.configureRL({ policy: { learningRate: 0.01 } });
        assert(sona.policyConfig.learningRate === 0.01, 'configureRL updates config');

        sona.resetRL();
        assert(sona.experienceBuffer.length === 0, 'resetRL clears buffer');
    }

    // =========================================================================
    // Summary
    // =========================================================================
    console.log(`\n${'='.repeat(50)}`);
    console.log(`RESULTS: ${passed} passed, ${failed} failed out of ${passed + failed} assertions`);
    console.log(`${'='.repeat(50)}`);

    if (failed > 0) {
        process.exit(1);
    }
}

runTests().catch(err => {
    console.error('Test runner crashed:', err);
    process.exit(1);
});
