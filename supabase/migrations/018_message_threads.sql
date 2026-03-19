-- 018_message_threads.sql
-- Adds thread support to conversation_messages.
-- Thread replies point to a top-level message via thread_parent_id.
-- A cached counter (thread_reply_count) is kept on the parent for fast UI renders.

-- ─── Schema ────────────────────────────────────────────────────────────────────

ALTER TABLE public.conversation_messages
  ADD COLUMN thread_parent_id uuid REFERENCES public.conversation_messages(id) ON DELETE CASCADE,
  ADD COLUMN thread_reply_count integer NOT NULL DEFAULT 0;

-- Fast lookup: all replies belonging to a thread
CREATE INDEX idx_conv_messages_thread_parent
  ON public.conversation_messages(thread_parent_id)
  WHERE thread_parent_id IS NOT NULL;

-- ─── Counter triggers ──────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.increment_thread_reply_count()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.thread_parent_id IS NOT NULL THEN
    UPDATE public.conversation_messages
    SET thread_reply_count = thread_reply_count + 1
    WHERE id = NEW.thread_parent_id;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.decrement_thread_reply_count()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.thread_parent_id IS NOT NULL THEN
    UPDATE public.conversation_messages
    SET thread_reply_count = GREATEST(0, thread_reply_count - 1)
    WHERE id = OLD.thread_parent_id;
  END IF;
  RETURN OLD;
END;
$$;

CREATE TRIGGER thread_reply_count_inc
  AFTER INSERT ON public.conversation_messages
  FOR EACH ROW EXECUTE FUNCTION public.increment_thread_reply_count();

CREATE TRIGGER thread_reply_count_dec
  AFTER DELETE ON public.conversation_messages
  FOR EACH ROW EXECUTE FUNCTION public.decrement_thread_reply_count();
