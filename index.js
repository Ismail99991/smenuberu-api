// index.js
const { buildApp } = require('./dist/server.js');

let app;

exports.handler = async (event) => {
    if (!app) {
        console.log('🚀 Initializing Fastify app...');
        app = await buildApp();
        console.log('✅ Fastify app ready');
    }
    
    const { httpMethod, path, headers, body, queryStringParameters, requestContext } = event;
    
    console.log(`📥 ${httpMethod} ${path}`);
    
    const request = {
        method: httpMethod,
        url: path,
        headers: headers || {},
        query: queryStringParameters || {},
        body: body,
        remoteAddress: requestContext?.identity?.sourceIp || 'unknown'
    };
    
    try {
        const response = await app.inject(request);
        
        return {
            statusCode: response.statusCode,
            headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Credentials': 'true'
            },
            body: response.payload,
            isBase64Encoded: false
        };
    } catch (error) {
        console.error('❌ Handler error:', error);
        
        return {
            statusCode: 500,
            headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*'
            },
            body: JSON.stringify({
                ok: false,
                error: error.message
            }),
            isBase64Encoded: false
        };
    }
};