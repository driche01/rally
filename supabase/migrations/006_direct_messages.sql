-- Direct messaging system: 1:1 DMs and group chats
-- Separate from trip_messages (which is trip-wide group chat in the hub)

-- Conversations: either a 1:1 DM or a named group chat
CREATE TABLE conversations (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type        TEXT NOT NULL CHECK (type IN ('dm', 'group')),
  name        TEXT,           -- for group chats; NULL for DMs
  avatar_url  TEXT,           -- optional group avatar
  created_by  UUID REFERENCES profiles(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()  -- bumped on each new message
);

-- Members of a conversation
CREATE TABLE conversation_members (
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  profile_id      UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  joined_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_read_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (conversation_id, profile_id)
);

-- Messages within a conversation
CREATE TABLE conversation_messages (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  sender_id       UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  content         TEXT NOT NULL CHECK (char_length(content) BETWEEN 1 AND 2000),
  reply_to_id     UUID REFERENCES conversation_messages(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  edited_at       TIMESTAMPTZ
);

CREATE INDEX idx_conv_messages_conv_id ON conversation_messages(conversation_id, created_at DESC);

-- Emoji reactions on conversation messages
CREATE TABLE conversation_reactions (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id  UUID NOT NULL REFERENCES conversation_messages(id) ON DELETE CASCADE,
  profile_id  UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  emoji       TEXT NOT NULL CHECK (char_length(emoji) <= 8),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (message_id, profile_id, emoji)
);

-- Bump conversations.updated_at whenever a new message is inserted
CREATE OR REPLACE FUNCTION bump_conversation_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  UPDATE conversations SET updated_at = now() WHERE id = NEW.conversation_id;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_bump_conversation
AFTER INSERT ON conversation_messages
FOR EACH ROW EXECUTE FUNCTION bump_conversation_updated_at();

-- RLS
ALTER TABLE conversations          ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversation_members   ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversation_messages  ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversation_reactions ENABLE ROW LEVEL SECURITY;

-- Conversations: visible to members only
CREATE POLICY "Members can view conversations"
  ON conversations FOR SELECT
  USING (
    id IN (
      SELECT conversation_id FROM conversation_members
      WHERE profile_id = auth.uid()
    )
  );

CREATE POLICY "Members can create conversations"
  ON conversations FOR INSERT
  WITH CHECK (created_by = auth.uid());

-- Conversation members: visible within the conversation
CREATE POLICY "Members can view membership"
  ON conversation_members FOR SELECT
  USING (
    conversation_id IN (
      SELECT conversation_id FROM conversation_members
      WHERE profile_id = auth.uid()
    )
  );

CREATE POLICY "Members can join/leave"
  ON conversation_members FOR INSERT
  WITH CHECK (profile_id = auth.uid());

CREATE POLICY "Members can remove themselves"
  ON conversation_members FOR DELETE
  USING (profile_id = auth.uid());

-- Messages: members can read and send
CREATE POLICY "Members can read messages"
  ON conversation_messages FOR SELECT
  USING (
    conversation_id IN (
      SELECT conversation_id FROM conversation_members
      WHERE profile_id = auth.uid()
    )
  );

CREATE POLICY "Members can send messages"
  ON conversation_messages FOR INSERT
  WITH CHECK (
    sender_id = auth.uid() AND
    conversation_id IN (
      SELECT conversation_id FROM conversation_members
      WHERE profile_id = auth.uid()
    )
  );

CREATE POLICY "Senders can delete their messages"
  ON conversation_messages FOR DELETE
  USING (sender_id = auth.uid());

-- Reactions: members can read and add/remove their own
CREATE POLICY "Members can read reactions"
  ON conversation_reactions FOR SELECT
  USING (
    message_id IN (
      SELECT cm.id FROM conversation_messages cm
      JOIN conversation_members mb ON mb.conversation_id = cm.conversation_id
      WHERE mb.profile_id = auth.uid()
    )
  );

CREATE POLICY "Members can react"
  ON conversation_reactions FOR INSERT
  WITH CHECK (profile_id = auth.uid());

CREATE POLICY "Members can remove their reactions"
  ON conversation_reactions FOR DELETE
  USING (profile_id = auth.uid());
