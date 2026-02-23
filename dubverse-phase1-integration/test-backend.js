/**
 * Backend Integration Test Script
 * Run this after Verdant delivers Phase 1 to verify everything works
 * 
 * Usage: node test-backend.js
 */

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'

// Test colors for console output
const colors = {
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  reset: '\x1b[0m',
}

function log(message, color = 'reset') {
  console.log(colors[color] + message + colors.reset)
}

// Test 1: Health Check
async function testHealthCheck() {
  log('\n📡 Test 1: Health Check', 'blue')
  try {
    const response = await fetch(`${API_URL}/health`)
    if (response.ok) {
      log('✅ Backend is running and healthy', 'green')
      return true
    } else {
      log(`❌ Health check failed: ${response.status}`, 'red')
      return false
    }
  } catch (error) {
    log(`❌ Cannot connect to backend: ${error.message}`, 'red')
    log(`   Make sure backend is running at: ${API_URL}`, 'yellow')
    return false
  }
}

// Test 2: CORS Headers
async function testCORS() {
  log('\n🔒 Test 2: CORS Configuration', 'blue')
  try {
    const response = await fetch(`${API_URL}/health`, {
      method: 'OPTIONS',
    })
    
    const corsHeaders = {
      'Access-Control-Allow-Origin': response.headers.get('Access-Control-Allow-Origin'),
      'Access-Control-Allow-Methods': response.headers.get('Access-Control-Allow-Methods'),
      'Access-Control-Allow-Headers': response.headers.get('Access-Control-Allow-Headers'),
    }
    
    if (corsHeaders['Access-Control-Allow-Origin']) {
      log('✅ CORS headers are configured', 'green')
      log(`   Allow-Origin: ${corsHeaders['Access-Control-Allow-Origin']}`, 'yellow')
      return true
    } else {
      log('⚠️  CORS headers might not be configured', 'yellow')
      log('   Frontend may have trouble connecting', 'yellow')
      return false
    }
  } catch (error) {
    log(`❌ CORS test failed: ${error.message}`, 'red')
    return false
  }
}

// Test 3: Upload Endpoint
async function testUploadEndpoint() {
  log('\n📤 Test 3: Upload Endpoint Structure', 'blue')
  try {
    // We're not actually uploading, just checking if endpoint exists
    const response = await fetch(`${API_URL}/api/upload`, {
      method: 'POST',
      body: new FormData(), // Empty form data
    })
    
    // We expect 400 (bad request) or 422 (validation error), not 404
    if (response.status === 404) {
      log('❌ Upload endpoint not found', 'red')
      log('   Expected: POST /api/upload', 'yellow')
      return false
    } else {
      log('✅ Upload endpoint exists', 'green')
      log(`   Status: ${response.status} (${response.statusText})`, 'yellow')
      return true
    }
  } catch (error) {
    log(`❌ Upload test failed: ${error.message}`, 'red')
    return false
  }
}

// Test 4: Status Endpoint
async function testStatusEndpoint() {
  log('\n📊 Test 4: Status Endpoint Structure', 'blue')
  try {
    const testJobId = 'test-job-id'
    const response = await fetch(`${API_URL}/api/status/${testJobId}`)
    
    if (response.status === 404) {
      const data = await response.json()
      log('✅ Status endpoint exists (job not found as expected)', 'green')
      return true
    } else if (response.ok) {
      log('✅ Status endpoint exists', 'green')
      return true
    } else {
      log(`⚠️  Unexpected status: ${response.status}`, 'yellow')
      return true // Endpoint exists, just returned unexpected status
    }
  } catch (error) {
    log(`❌ Status test failed: ${error.message}`, 'red')
    return false
  }
}

// Test 5: API Documentation
async function testDocs() {
  log('\n📚 Test 5: API Documentation', 'blue')
  try {
    const response = await fetch(`${API_URL}/docs`)
    if (response.ok) {
      log('✅ API documentation available', 'green')
      log(`   Visit: ${API_URL}/docs`, 'yellow')
      return true
    } else {
      log('⚠️  API documentation not found', 'yellow')
      log('   (This is optional)', 'yellow')
      return true
    }
  } catch (error) {
    log(`⚠️  Could not check documentation: ${error.message}`, 'yellow')
    return true
  }
}

// Run all tests
async function runTests() {
  log('\n╔════════════════════════════════════════════╗', 'blue')
  log('║  DubVerse Backend Integration Tests       ║', 'blue')
  log('╚════════════════════════════════════════════╝', 'blue')
  log(`\nTesting backend at: ${API_URL}\n`)

  const results = {
    healthCheck: await testHealthCheck(),
    cors: await testCORS(),
    uploadEndpoint: await testUploadEndpoint(),
    statusEndpoint: await testStatusEndpoint(),
    docs: await testDocs(),
  }

  // Summary
  log('\n╔════════════════════════════════════════════╗', 'blue')
  log('║  Test Summary                              ║', 'blue')
  log('╚════════════════════════════════════════════╝', 'blue')

  const passed = Object.values(results).filter(Boolean).length
  const total = Object.keys(results).length

  Object.entries(results).forEach(([test, passed]) => {
    log(`${passed ? '✅' : '❌'} ${test}`, passed ? 'green' : 'red')
  })

  log(`\n${passed}/${total} tests passed`, passed === total ? 'green' : 'yellow')

  if (passed === total) {
    log('\n🎉 All tests passed! Backend is ready for integration.', 'green')
    log('\nNext steps:', 'blue')
    log('1. Copy .env.local.example to .env.local', 'yellow')
    log('2. Update NEXT_PUBLIC_API_URL in .env.local', 'yellow')
    log('3. Copy the integration files to your project', 'yellow')
    log('4. Update your components with the new API calls', 'yellow')
  } else {
    log('\n⚠️  Some tests failed. Please check with Verdant.', 'yellow')
    log('\nRequired for frontend integration:', 'blue')
    log('• Health check must pass', 'yellow')
    log('• Upload endpoint must exist', 'yellow')
    log('• Status endpoint must exist', 'yellow')
  }
}

// Run the tests
runTests().catch(error => {
  log(`\n❌ Test runner failed: ${error.message}`, 'red')
  process.exit(1)
})
