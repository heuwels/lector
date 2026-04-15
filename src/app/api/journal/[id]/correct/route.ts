import { NextRequest, NextResponse } from 'next/server';
import { prompt } from '@/lib/server/anthropic';
import { db, JournalEntryRow } from '@/lib/server/database';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const entry = db.prepare('SELECT * FROM journal_entries WHERE id = ?').get(id) as JournalEntryRow | undefined;

  if (!entry) {
    return NextResponse.json({ error: 'Entry not found' }, { status: 404 });
  }

  if (!entry.body.trim()) {
    return NextResponse.json({ error: 'Entry body is empty' }, { status: 400 });
  }

  try {
    const promptText = `You are an Afrikaans language tutor reviewing a student's journal entry. The student is an English speaker learning Afrikaans.

Correct the following Afrikaans text. For each error found, provide the correction and a brief explanation in English.

Student's text:
"""
${entry.body}
"""

Respond with ONLY a JSON object in this exact format (no markdown, no code blocks):
{"correctedBody": "the full corrected text in Afrikaans", "corrections": [{"original": "the incorrect word or phrase", "corrected": "the correct version", "explanation": "brief English explanation of why this is wrong and the rule", "type": "grammar|spelling|word_choice|word_order|missing_word|extra_word"}]}

If the text is perfect, return an empty corrections array.
Focus on: spelling errors, grammar (verb conjugation, tense, word order), word choice, missing or extra words, and idiomatic corrections.
Keep explanations concise (1-2 sentences) and educational.`;

    const responseText = await prompt(promptText);
    const result = JSON.parse(responseText);
    const now = new Date().toISOString();

    db.prepare(`
      UPDATE journal_entries
      SET correctedBody = ?, corrections = ?, status = 'submitted', updatedAt = ?
      WHERE id = ?
    `).run(result.correctedBody, JSON.stringify(result.corrections), now, id);

    return NextResponse.json({
      correctedBody: result.correctedBody,
      corrections: result.corrections,
    });
  } catch (error) {
    console.error('Journal correction error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Correction failed' },
      { status: 500 }
    );
  }
}
