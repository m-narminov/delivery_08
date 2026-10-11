import { Anchor, type AnchorProps } from '@mantine/core';
import { createLink } from '@tanstack/react-router';
import type { ComponentPropsWithRef } from 'react';

type MantineAnchorProps = AnchorProps & Omit<ComponentPropsWithRef<'a'>, keyof AnchorProps>;

function MantineAnchor(props: MantineAnchorProps) {
  return <Anchor component="a" {...props} />;
}

// Ссылка роутера в виде Anchor из Mantine. createLink, а не <Anchor component={Link}> или
// renderRoot: у них пропсы ссылки типизированы как any, и TypeScript не заметил бы ни
// несуществующий путь, ни неверный тип параметра. Здесь `to` и `params` проверяются по
// зарегистрированному роутеру.
export const AnchorLink = createLink(MantineAnchor);
