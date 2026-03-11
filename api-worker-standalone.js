// Standalone Cloudflare Worker for API endpoints
// Copy this code into Cloudflare Workers dashboard

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    
    // CORS headers
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    };

    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    // Route: GET /api/admin/jobs - Poll for pending encoding jobs
    if (url.pathname === '/api/admin/jobs' && request.method === 'GET') {
      try {
        // Find one pending job
        const job = await env.DB.prepare(
          "SELECT * FROM encoding_jobs WHERE status = 'pending' ORDER BY created_at ASC LIMIT 1"
        ).first();

        if (!job) {
          return new Response(JSON.stringify({ job: null }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }

        // Mark it as processing immediately so other workers don't grab it
        await env.DB.prepare(
          "UPDATE encoding_jobs SET status = 'processing', updated_at = DATETIME('now') WHERE id = ?"
        ).bind(job.id).run();

        return new Response(JSON.stringify({ job }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      } catch (error) {
        return new Response(JSON.stringify({ error: error.message }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }
    }

    // Route: PATCH /api/admin/jobs - Update job status
    if (url.pathname === '/api/admin/jobs' && request.method === 'PATCH') {
      try {
        const body = await request.json();
        const {
          jobId,
          status,
          error,
          masterPlaylistKey,
          fastStreamKey,
          lowStreamKey,
          fastStreamSize,
          lowStreamSize
        } = body;

        if (!jobId || !status) {
          return new Response(JSON.stringify({ error: "Missing jobId or status" }), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }

        // 1. Update the Job record
        await env.DB.prepare(
          "UPDATE encoding_jobs SET status = ?, error = ?, updated_at = DATETIME('now') WHERE id = ?"
        ).bind(status, error || null, jobId).run();

        // 2. If completed, update the Video record with the new HLS keys
        if (status === 'completed') {
          const job = await env.DB.prepare("SELECT video_id FROM encoding_jobs WHERE id = ?").bind(jobId).first();

          if (job) {
            await env.DB.prepare(
              `UPDATE videos SET 
                  r2_key = ?, 
                  fast_stream_key = ?, 
                  low_stream_key = ?, 
                  fast_stream_size = ?,
                  low_stream_size = ?,
                  processing_status = 'completed' 
               WHERE id = ?`
            ).bind(
              masterPlaylistKey,
              fastStreamKey || null,
              lowStreamKey || null,
              fastStreamSize || null,
              lowStreamSize || null,
              job.video_id
            ).run();
          }
        } else if (status === 'failed') {
          const job = await env.DB.prepare("SELECT video_id FROM encoding_jobs WHERE id = ?").bind(jobId).first();
          if (job) {
            await env.DB.prepare("UPDATE videos SET processing_status = 'failed' WHERE id = ?")
              .bind(job.video_id).run();
          }
        }

        return new Response(JSON.stringify({ success: true }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      } catch (error) {
        return new Response(JSON.stringify({ error: error.message }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }
    }

    // For all other routes, proxy to the main site
    const mainSiteUrl = new URL(request.url);
    mainSiteUrl.hostname = 'ott.gtsounds.com';
    
    return fetch(mainSiteUrl, {
      method: request.method,
      headers: request.headers,
      body: request.body
    });
  },
};